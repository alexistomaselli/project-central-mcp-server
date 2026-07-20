
export interface TldrawShape {
    id: string;
    typeName: 'shape';
    type: string;
    x: number;
    y: number;
    rotation: number;
    index: string;
    parentId: string;
    props: any;
    meta: any;
}

export function mermaidToTldraw(mermaidCode: string, title: string = 'Mermaid Diagram'): any {
    const lines = mermaidCode.split('\n').map(l => l.trim()).filter(l => l.length > 0 && !l.startsWith('%%'));
    
    // Initial Store structure
    const store: any = {
        "document:document": {
            "id": "document:document",
            "typeName": "document",
            "meta": {},
            "gridSize": 10,
            "name": title
        },
        "page:page": {
            "id": "page:page",
            "typeName": "page",
            "name": "Page 1",
            "index": "a1",
            "meta": {}
        }
    };

    let orientation = 'TD';
    const nodes = new Map<string, { id: string, text: string, type: string, parentId: string }>();
    const edges: { from: string, to: string, text?: string }[] = [];
    const subgraphs = new Map<string, { id: string, text: string, nodeIds: string[] }>();
    
    let currentSubgraph: string | null = null;

    // Advanced Parsing
    lines.forEach(line => {
        const lowerLine = line.toLowerCase();
        
        if (lowerLine.startsWith('graph ') || lowerLine.startsWith('flowchart ')) {
            const parts = line.split(/\s+/);
            if (parts.length > 1) orientation = parts[1];
            return;
        }

        if (lowerLine.startsWith('subgraph ')) {
            // Match subgraph ID["Text"] or subgraph ID [Text]
            const match = line.match(/subgraph\s+([\w\d_-]+)(?:\s*\["(.*?)"\]|\s*\[(.*?)\])?/i);
            if (match) {
                const id = match[1];
                const text = match[2] || match[3] || id;
                currentSubgraph = id;
                subgraphs.set(id, { id, text, nodeIds: [] });
            }
            return;
        }

        if (lowerLine === 'end') {
            currentSubgraph = null;
            return;
        }

        // Match edges: A --> B or A -- "text" --> B or A["Text"] --> B
        const arrowMatch = line.match(/^(.+?)\s*(-{2,3}>|--.*?-->)\s*(.+)$/);
        
        if (arrowMatch) {
            const fromRaw = arrowMatch[1].trim();
            const toRaw = arrowMatch[3].trim();
            const edgeTextMatch = arrowMatch[2].match(/--\s*"(.*?)"\s*-->/) || arrowMatch[2].match(/--\s*(.*?)\s*-->/);
            const edgeText = edgeTextMatch ? (edgeTextMatch[1] || edgeTextMatch[2]) : undefined;

            const fromNodeId = parseNode(fromRaw);
            const toNodeId = parseNode(toRaw);
            
            edges.push({ from: fromNodeId, to: toNodeId, text: edgeText });
        } else {
            parseNode(line);
        }
    });

    function parseNode(raw: string): string {
        // Updated regex for ID["Text"] or ID[Text] or ID(Text) etc.
        const match = raw.match(/^([\w\d_-]+)\s*(?:([\[\(\{]|\[")\s*(.*?)\s*(?:[\}\]\)]|"\]))?$/);
        if (!match) return raw;

        const id = match[1];
        let text = (match[3] || id).replace(/^"|"$/g, '');
        let type = 'rectangle';
        const bracket = match[2];
        
        if (bracket === '(') type = 'ellipse';
        if (bracket === '{') type = 'rhombus';

        if (!nodes.has(id)) {
            nodes.set(id, { id, text, type, parentId: currentSubgraph || 'page:page' });
            if (currentSubgraph) {
                subgraphs.get(currentSubgraph)?.nodeIds.push(id);
            }
        }
        return id;
    }

    // Simplified Auto-Layout
    const nodeArray = Array.from(nodes.values());
    const LEVEL_SPACING = 300;
    const NODE_SPACING = 200;
    
    const levels = new Map<string, number>();
    const nodeLevelMap = new Map<number, string[]>();

    const incomingCount = new Map<string, number>();
    nodeArray.forEach(n => incomingCount.set(n.id, 0));
    edges.forEach(e => incomingCount.set(e.to, (incomingCount.get(e.to) || 0) + 1));

    let queue = nodeArray.filter(n => incomingCount.get(n.id) === 0).map(n => n.id);
    if (queue.length === 0 && nodeArray.length > 0) queue = [nodeArray[0].id];

    let currentLvl = 0;
    while (queue.length > 0) {
        nodeLevelMap.set(currentLvl, queue);
        const nextQueue: string[] = [];
        queue.forEach(id => {
            levels.set(id, currentLvl);
            edges.filter(e => e.from === id).forEach(e => {
                if (!levels.has(e.to)) nextQueue.push(e.to);
            });
        });
        queue = Array.from(new Set(nextQueue));
        currentLvl++;
        if (currentLvl > 50) break;
    }

    nodeArray.forEach(n => {
        if (!levels.has(n.id)) {
            levels.set(n.id, currentLvl);
            const list = nodeLevelMap.get(currentLvl) || [];
            list.push(n.id);
            nodeLevelMap.set(currentLvl, list);
        }
    });

    const shapeIds = new Map<string, string>();
    const nodeWidth = 200;
    const nodeHeight = 80;

    // Create Node Shapes
    nodeLevelMap.forEach((ids, level) => {
        ids.forEach((id, index) => {
            const n = nodes.get(id);
            if (!n) return;

            const tldrawId = `shape:node_${id}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            shapeIds.set(id, tldrawId);

            let x, y;
            if (orientation === 'LR') {
                x = level * LEVEL_SPACING + 150;
                y = index * NODE_SPACING + 150;
            } else {
                x = index * NODE_SPACING + 150;
                y = level * LEVEL_SPACING + 150;
            }

            store[tldrawId] = {
                id: tldrawId,
                typeName: 'shape',
                type: 'geo',
                x,
                y,
                rotation: 0,
                parentId: 'page:page',
                index: `a${level}${index}`,
                props: {
                    geo: n.type === 'ellipse' ? 'ellipse' : (n.type === 'rhombus' ? 'diamond' : 'rectangle'),
                    w: nodeWidth,
                    h: nodeHeight,
                    text: n.text,
                    font: 'draw',
                    align: 'middle',
                    verticalAlign: 'middle',
                    color: n.parentId !== 'page:page' ? 'blue' : 'black',
                    fill: 'none',
                    dash: 'draw',
                    size: 'm'
                },
                meta: {}
            };
        });
    });

    // Create Edges
    edges.forEach((e, i) => {
        const fromTldrawId = shapeIds.get(e.from);
        const toTldrawId = shapeIds.get(e.to);
        if (!fromTldrawId || !toTldrawId) return;

        const arrowId = `shape:edge_${i}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        store[arrowId] = {
            id: arrowId,
            typeName: 'shape',
            type: 'arrow',
            x: 0,
            y: 0,
            rotation: 0,
            parentId: 'page:page',
            index: `b${i}`,
            props: {
                start: { type: 'binding', boundShapeId: fromTldrawId, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false },
                end: { type: 'binding', boundShapeId: toTldrawId, normalizedAnchor: { x: 0.5, y: 0.5 }, isExact: false },
                arrowheadStart: 'none',
                arrowheadEnd: 'arrow',
                text: e.text || '',
                color: 'grey',
                dash: 'draw',
                size: 'm'
            },
            meta: {}
        };
    });

    return {
        store,
        schema: {
            schemaVersion: 2,
            sequences: {
                "com.tldraw.store": 4,
                "com.tldraw.asset": 1,
                "com.tldraw.camera": 3,
                "com.tldraw.document": 2,
                "com.tldraw.instance": 24,
                "com.tldraw.instance_page_state": 5,
                "com.tldraw.page": 1,
                "com.tldraw.shape": 4,
                "com.tldraw.user": 1,
                "com.tldraw.user_document": 3,
                "com.tldraw.user_presence": 7
            }
        }
    };
}
