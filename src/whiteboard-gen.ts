
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

export function generateMindMap(title: string, concepts: string[]): any {
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
        },
        "instance:instance": {
            "id": "instance:instance",
            "typeName": "instance",
            "currentPageId": "page:page",
            "followingUserId": null,
            "brush": null,
            "opacityForNextShape": 1,
            "stylesForNextShape": {},
            "cursor": { "type": "default", "rotation": 0 },
            "isEditing": false,
            "isFocused": true,
            "isHelpOpen": false,
            "isReadOnly": false,
            "screenBounds": { "x": 0, "y": 0, "w": 1000, "h": 800 },
            "zoomLevel": 1,
            "chatMessage": "",
            "isChatting": false,
            "isMenuOpen": false,
            "isSidebarOpen": false,
            "canMoveCamera": true,
            "isPenMode": false,
            "isGridMode": false,
            "isMobile": false,
            "meta": {}
        },
        "instance_page_state:page:page": {
            "id": "instance_page_state:page:page",
            "typeName": "instance_page_state",
            "instanceId": "instance:instance",
            "pageId": "page:page",
            "focusedShapeId": null,
            "selectedShapeIds": [],
            "meta": {}
        },
        "camera:page:page": {
            "id": "camera:page:page",
            "typeName": "camera",
            "x": 0,
            "y": 0,
            "z": 1,
            "meta": {}
        }
    };

    const centerX = 500;
    const centerY = 400;

    // Central Node
    const centralId = `shape:central_${Date.now()}`;
    store[centralId] = {
        id: centralId,
        typeName: 'shape',
        type: 'geo',
        x: centerX - 100,
        y: centerY - 40,
        parentId: 'page:page',
        index: 'a1',
        props: {
            geo: 'ellipse',
            w: 200,
            h: 80,
            text: title,
            font: 'draw',
            align: 'middle',
            verticalAlign: 'middle',
            color: 'blue',
            fill: 'pattern',
            dash: 'draw',
            size: 'm'
        },
        meta: {}
    };

    // Concepts
    concepts.forEach((concept, i) => {
        const angle = (i / concepts.length) * Math.PI * 2;
        const radius = 280;
        const branchX = centerX + Math.cos(angle) * radius;
        const branchY = centerY + Math.sin(angle) * radius;

        const branchId = `shape:concept_${i}_${Date.now()}`;
        store[branchId] = {
            id: branchId,
            typeName: 'shape',
            type: 'geo',
            x: branchX - 80,
            y: branchY - 30,
            parentId: 'page:page',
            index: `a${i + 2}`,
            props: {
                geo: 'rectangle',
                w: 160,
                h: 60,
                text: concept,
                font: 'draw',
                align: 'middle',
                verticalAlign: 'middle',
                color: 'violet',
                fill: 'none',
                dash: 'draw',
                size: 's'
            },
            meta: {}
        };

        // Arrow
        const arrowId = `shape:arrow_${i}_${Date.now()}`;
        store[arrowId] = {
            id: arrowId,
            typeName: 'shape',
            type: 'arrow',
            x: centerX,
            y: centerY,
            parentId: 'page:page',
            index: `b${i + 1}`,
            props: {
                start: { x: 0, y: 0 },
                end: { x: branchX - centerX, y: branchY - centerY },
                arrowheadStart: 'none',
                arrowheadEnd: 'arrow',
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
