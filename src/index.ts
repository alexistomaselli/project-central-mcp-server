console.error(">>> [v1.1-Heartbeat-Absolute] MCP SERVER STARTING... " + new Date().toISOString());
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import express from "express";
import cors from "cors";
import { spawn } from "child_process";
import { generateMindMap } from "./whiteboard-gen.js";
import { mermaidToTldraw } from "./mermaid-to-tldraw.js";
import { financeTools, handleFinanceTool } from "./finance-tools.js";

dotenv.config();

const supabaseUrl = process.env.SUPABASE_URL || "";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
}

const supabase = createClient(supabaseUrl, supabaseKey);

const server = new Server(
  {
    name: "project-management-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// --- Helper: Call NotebookLM Python Bridge ---
async function callNotebookLM(command: string, args: any, userId?: string) {
  if (!userId) throw new Error("User ID is required for NotebookLM tools");

  // 1. Get cookies from DB
  const { data: configData } = await supabase.from('ai_config').select('notebooklm_cookies').eq('user_id', userId).limit(1);
  const config = configData && configData.length > 0 ? configData[0] : null;
  const cookies = config?.notebooklm_cookies || "";

  return new Promise((resolve, reject) => {
    // Determine python path (check for venv in docker)
    const pythonPath = process.env.NODE_ENV === 'production' ? 'python3' : 'python3';
    const py = spawn(pythonPath, ['src/notebooklm_bridge.py', command]);

    let output = '';
    let error = '';

    py.stdin.write(JSON.stringify({ args, cookies }));
    py.stdin.end();

    py.stdout.on('data', (data) => output += data.toString());
    py.stderr.on('data', (data) => error += data.toString());

    py.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python process exited with code ${code}: ${error}`));
        return;
      }
      try {
        const parsed = JSON.parse(output);
        if (parsed.error) reject(new Error(parsed.error));
        else resolve(parsed.result);
      } catch (parseErr) {
        reject(new Error(`Failed to parse Python output: ${output}`));
      }
    });
  });
}

// --- Tool Handlers ---

server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "add_project",
        description: "Add a new software project to the central management system",
        inputSchema: {
          type: "object",
          properties: {
            name: { type: "string", description: "Project name" },
            description: { type: "string", description: "Project description" },
            repository_url: { type: "string", description: "GitHub/GitLab repository URL" },
          },
          required: ["name"],
        },
      },
      {
        name: "add_issue",
        description: "Create a new issue, bug or task for a specific project",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Exact or partial name of the project" },
            title: { type: "string", description: "Issue title" },
            description: { type: "string", description: "Detailed description of the issue" },
            priority: {
              type: "string",
              enum: ["low", "medium", "high", "urgent"],
              default: "medium"
            },
          },
          required: ["project_name", "title"],
        },
      },
      {
        name: "update_issue_status",
        description: "Update the status of an existing issue",
        inputSchema: {
          type: "object",
          properties: {
            issue_id: { type: "string", description: "The UUID of the issue" },
            status: {
              type: "string",
              enum: ["todo", "in_progress", "review", "done"]
            },
          },
          required: ["issue_id", "status"],
        },
      },
      {
        name: "update_issue",
        description: "Update any property of an existing issue (title, description, priority, status, assignees)",
        inputSchema: {
          type: "object",
          properties: {
            issue_id: { type: "string", description: "The UUID of the issue" },
            title: { type: "string", description: "New title" },
            description: { type: "string", description: "New description" },
            priority: { type: "string", enum: ["low", "medium", "high", "urgent"] },
            status: { type: "string", enum: ["todo", "in_progress", "review", "done"] },
            assignees: { type: "array", items: { type: "string" }, description: "List of usernames assigned" }
          },
          required: ["issue_id"],
        },
      },
      {
        name: "list_all_projects",
        description: "List all software projects currently being managed",
        inputSchema: { type: "object", properties: {} },
      },
      {
        name: "get_project_details",
        description: "Get comprehensive details of a project, including its issues and recent activity",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Name of the project" },
          },
          required: ["project_name"],
        },
      },
      {
        name: "list_issues",
        description: "List issues across all projects or filtered by status, priority or project name",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Filter by project name (optional)" },
            status: { type: "string", enum: ["todo", "in_progress", "review", "done"], description: "Filter by status" },
            priority: { type: "string", enum: ["low", "medium", "high", "urgent"], description: "Filter by priority" }
          }
        }
      },
      {
        name: "add_issue_comment",
        description: "Add a comment to a specific issue",
        inputSchema: {
          type: "object",
          properties: {
            issue_id: { type: "string", description: "The UUID of the issue" },
            author_name: { type: "string", description: "Name of the comment author" },
            content: { type: "string", description: "The content of the comment" }
          },
          required: ["issue_id", "author_name", "content"]
        }
      },
      {
        name: "add_project_doc",
        description: "Create a new Markdown document for a project (e.g., scope, technical spec, meeting notes)",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Name of the project" },
            title: { type: "string", description: "Document title" },
            content: { type: "string", description: "Markdown content" },
            doc_type: {
              type: "string",
              enum: ["draft", "scope", "technical", "meeting", "requirements"],
              default: "draft"
            },
            issue_id: { type: "string", description: "Optional UUID of an issue to link to" }
          },
          required: ["project_name", "title", "content"]
        }
      },
      {
        name: "update_project_doc",
        description: "Update the content or title of an existing project document",
        inputSchema: {
          type: "object",
          properties: {
            doc_id: { type: "string", description: "UUID of the document" },
            title: { type: "string", description: "New title" },
            content: { type: "string", description: "New Markdown content" }
          },
          required: ["doc_id"]
        }
      },
      {
        name: "list_project_docs",
        description: "List all documents associated with a project",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Name of the project" }
          },
          required: ["project_name"]
        }
      },
      {
        name: "get_document_content",
        description: "Retrieve the full Markdown content of a specific document for analysis",
        inputSchema: {
          type: "object",
          properties: {
            doc_id: { type: "string", description: "UUID of the document" }
          },
          required: ["doc_id"]
        }
      },
      {
        name: "list_whiteboards",
        description: "List all whiteboards associated with a project",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Name of the project" }
          },
          required: ["project_name"]
        }
      },
      {
        name: "get_whiteboard_data",
        description: "Get the JSON structure (tldraw) of a specific whiteboard",
        inputSchema: {
          type: "object",
          properties: {
            whiteboard_id: { type: "string", description: "UUID of the whiteboard" }
          },
          required: ["whiteboard_id"]
        }
      },
      {
        name: "add_whiteboard",
        description: "Create a new whiteboard. You MUST provide the tldraw JSON structure in 'data'.",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Name of the project" },
            name: { type: "string", description: "Name of the whiteboard" },
            data: { type: "object", description: "The tldraw JSON snapshot structure" }
          },
          required: ["project_name", "name", "data"]
        }
      },
      {
        name: "update_whiteboard",
        description: "Modify an existing whiteboard's content",
        inputSchema: {
          type: "object",
          properties: {
            whiteboard_id: { type: "string", description: "UUID of the whiteboard" },
            data: { type: "object", description: "The new tldraw JSON snapshot structure" }
          },
          required: ["whiteboard_id", "data"]
        }
      },
      {
        name: "generate_mind_map",
        description: "Generate a Mind Map whiteboard from a list of concepts or based on an existing document content.",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Name of the project" },
            whiteboard_name: { type: "string", description: "Name of the new whiteboard" },
            concepts: { type: "array", items: { type: "string" }, description: "List of nodes/concepts for the mind map" },
            doc_id: { type: "string", description: "Optional: If provided, will try to use the document content to infer concepts" }
          },
          required: ["project_name", "whiteboard_name"]
        }
      },
      {
        name: "notebooklm_list",
        description: "List all Google NotebookLM notebooks for the user",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "The UUID of the user" }
          },
          required: ["user_id"]
        },
      },
      {
        name: "notebooklm_query",
        description: "Ask a question to a specific NotebookLM notebook using its deep context",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "The UUID of the user" },
            notebook_id: { type: "string", description: "The ID of the notebook" },
            query: { type: "string", description: "The question to ask" }
          },
          required: ["user_id", "notebook_id", "query"]
        }
      },
      {
        name: "notebooklm_add_doc",
        description: "Add a project document to a NotebookLM notebook as a source",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "The UUID of the user" },
            notebook_id: { type: "string", description: "The ID of the notebook" },
            doc_id: { type: "string", description: "The UUID of the project document" }
          },
          required: ["user_id", "notebook_id", "doc_id"]
        }
      },
      {
        name: "notebooklm_extract_concept_map",
        description: "Analyze a document using NotebookLM and return a high-quality hierarchy of concepts for a mind map.",
        inputSchema: {
          type: "object",
          properties: {
            user_id: { type: "string", description: "The UUID of the user" },
            notebook_id: { type: "string", description: "The ID of the notebook" },
            doc_id: { type: "string", description: "The UUID of the document to analyze" }
          },
          required: ["user_id", "notebook_id", "doc_id"]
        }
      },
      {
        name: "generate_whiteboard_from_mermaid",
        description: "Generate a tldraw whiteboard diagram from Mermaid code (flowcharts/graphs).",
        inputSchema: {
          type: "object",
          properties: {
            project_name: { type: "string", description: "Name of the project" },
            whiteboard_name: { type: "string", description: "Name of the new whiteboard" },
            mermaid_code: { type: "string", description: "The Mermaid diagram syntax code (e.g. graph TD; A-->B;)" }
          },
          required: ["project_name", "whiteboard_name", "mermaid_code"]
        }
      },
      {
        name: "import_mermaid_to_whiteboard",
        description: "Import and merge Mermaid diagram shapes into an EXISTING tldraw whiteboard.",
        inputSchema: {
          type: "object",
          properties: {
            whiteboard_id: { type: "string", description: "The UUID of the existing whiteboard" },
            mermaid_code: { type: "string", description: "The Mermaid diagram syntax code" }
          },
          required: ["whiteboard_id", "mermaid_code"]
        }
      },
      ...financeTools
    ],
  };
});

// --- Shared Tool Handler (used by both MCP and direct HTTP invoke) ---
async function handleTool(name: string, args: any): Promise<any> {
  try {
    const financeResult = await handleFinanceTool(name, args, supabase);
    if (financeResult) {
      return financeResult;
    }

    switch (name) {
      case "add_project": {
        if (!args) throw new Error("Arguments are required for add_project");
        const { data: projectData, error } = await supabase
          .from("projects")
          .insert([{
            name: args.name as string,
            description: args.description as string,
            repository_url: args.repository_url as string
          }])
          .select()
          .limit(1);

        if (error) throw error;
        const data = projectData && projectData.length > 0 ? projectData[0] : null;

        if (!data) throw new Error("Failed to create project");

        await supabase.from("activities").insert([{
          project_id: data.id,
          action: "project_created",
          details: { name: data.name }
        }]);

        return {
          content: [{ type: "text", text: `🚀 Project "${data.name}" added to Central Management (ID: ${data.id}).` }],
        };
      }

      case "add_issue": {
        if (!args) throw new Error("Arguments are required for add_issue");
        const { data: projData, error: pErr } = await supabase
          .from("projects")
          .select("id, name")
          .ilike("name", `%${args.project_name as string}%`)
          .limit(1);

        const proj = projData && projData.length > 0 ? projData[0] : null;

        if (pErr || !proj) throw new Error(`Project matching "${args.project_name as string}" not found.`);

        const { data: issueData, error: iErr } = await supabase
          .from("issues")
          .insert([{
            project_id: proj.id,
            title: args.title as string,
            description: args.description as string,
            priority: (args.priority as string) || "medium"
          }])
          .select()
          .limit(1);

        if (iErr) throw iErr;
        const issue = issueData && issueData.length > 0 ? issueData[0] : null;
        if (!issue) throw new Error("Failed to create issue");

        await supabase.from("activities").insert([{
          project_id: proj.id,
          issue_id: issue.id,
          action: "issue_created",
          details: { title: issue.title }
        }]);

        return {
          content: [{ type: "text", text: `✅ Issue "${issue.title}" (ID: ${issue.id}) created for ${proj.name}.` }],
        };
      }

      case "update_issue_status": {
        if (!args) throw new Error("Arguments are required for update_issue_status");
        const { data: issueData, error: iErr } = await supabase
          .from("issues")
          .update({ status: args.status as string })
          .eq("id", args.issue_id as string)
          .select("id, title, project_id")
          .limit(1);

        if (iErr) throw iErr;
        const issue = issueData && issueData.length > 0 ? issueData[0] : null;
        if (!issue) throw new Error("Issue not found or updated failed");

        await supabase.from("activities").insert([{
          project_id: issue.project_id,
          issue_id: issue.id,
          action: "status_updated",
          details: { title: issue.title, new_status: args.status as string }
        }]);

        return {
          content: [{ type: "text", text: `✅ Status of issue "${issue.title}" updated to ${args.status as string}.` }],
        };
      }

      case "update_issue": {
        if (!args) throw new Error("Arguments are required for update_issue");
        const updates: any = {};
        if (args.title) updates.title = args.title;
        if (args.description) updates.description = args.description;
        if (args.priority) updates.priority = args.priority;
        if (args.status) updates.status = args.status;
        if (args.assignees) updates.assigned_to = args.assignees;

        const { data: issueData, error: iErr } = await supabase
          .from("issues")
          .update(updates)
          .eq("id", args.issue_id as string)
          .select("id, title, project_id")
          .limit(1);

        if (iErr) throw iErr;
        const issue = issueData && issueData.length > 0 ? issueData[0] : null;
        if (!issue) throw new Error("Issue not found or update failed");

        await supabase.from("activities").insert([{
          project_id: issue.project_id,
          issue_id: issue.id,
          action: "issue_updated",
          details: { title: issue.title, updated_fields: Object.keys(updates) }
        }]);

        return {
          content: [{ type: "text", text: `✅ Issue "${issue.title}" has been updated successfully.` }],
        };
      }

      case "list_all_projects": {
        const { data, error } = await supabase
          .from("projects")
          .select("name, status, progress, repository_url")
          .order("updated_at", { ascending: false });

        if (error) throw error;

        const list = data.map(p => {
          const repo = p.repository_url ? ` (${p.repository_url})` : '';
          return `- **${p.name}**: Status: ${p.status}, Progress: ${p.progress}%${repo}`;
        }).join("\n");

        return {
          content: [{ type: "text", text: list || "You don't have any projects yet. Use 'add_project' to start one!" }],
        };
      }

      case "get_project_details": {
        if (!args) throw new Error("Arguments are required for get_project_details");
        const { data: projData, error: pErr } = await supabase
          .from("projects")
          .select("*, issues(*), activities(*)")
          .ilike("name", `%${args.project_name as string}%`)
          .order('created_at', { foreignTable: 'activities', ascending: false })
          .limit(5, { foreignTable: 'activities' })
          .limit(1);

        const proj = projData && projData.length > 0 ? projData[0] : null;
        if (pErr || !proj) throw new Error(`Project "${args.project_name as string}" not found.`);

        const issuesList = proj.issues.map((i: any) => `  - [${i.status.toUpperCase()}] ${i.title} (${i.priority})`).join("\n");
        const activityList = proj.activities.map((a: any) => `  - ${a.action}: ${JSON.stringify(a.details)}`).join("\n");

        const summary = `
# ${proj.name}
Status: ${proj.status} | Progress: ${proj.progress}%
Repo: ${proj.repository_url || 'N/A'}

## Active Issues:
${issuesList || "  No issues found."}

## Recent Activity:
${activityList || "  No activity logged yet."}
        `;

        return {
          content: [{ type: "text", text: summary }],
        };
      }

      case "list_issues": {
        let query = supabase.from("issues").select("*, projects(name)");

        if (args?.status) query = query.eq("status", args.status);
        if (args?.priority) query = query.eq("priority", args.priority);
        if (args?.project_name) {
          const { data: projData } = await supabase.from("projects").select("id").ilike("name", `%${args.project_name}%`).limit(1);
          const proj = projData && projData.length > 0 ? projData[0] : null;
          if (proj) query = query.eq("project_id", proj.id);
        }

        const { data: issues, error } = await query.order("created_at", { ascending: false });
        if (error) throw error;

        const list = (issues || []).map(i => `- [${(i.projects as any)?.name}] **${i.title}** | Status: ${i.status.toUpperCase()} | Priority: ${i.priority.toUpperCase()} (ID: ${i.id})`).join("\n");

        return {
          content: [{ type: "text", text: list || "No se encontraron tareas con esos filtros." }],
        };
      }

      case "add_issue_comment": {
        if (!args) throw new Error("Arguments are required for add_issue_comment");
        const { data: commData, error: cErr } = await supabase
          .from("comments")
          .insert([{
            issue_id: args.issue_id as string,
            author_name: (args.author_name as string) || "Assistant",
            content: args.content as string
          }])
          .select()
          .limit(1);

        if (cErr) throw cErr;
        const comm = commData && commData.length > 0 ? commData[0] : null;
        if (!comm) throw new Error("Failed to create comment");

        // Log activity too
        const { data: issueData } = await supabase
          .from("issues")
          .select("project_id, title")
          .eq("id", args.issue_id as string)
          .limit(1);

        const issue = issueData && issueData.length > 0 ? issueData[0] : null;

        if (issue) {
          await supabase.from("activities").insert([{
            project_id: issue.project_id,
            issue_id: comm.issue_id,
            action: "commented",
            details: { title: issue.title, comment: (args.content as string).slice(0, 50) }
          }]);
        }

        return {
          content: [{ type: "text", text: `💬 Comment added to issue "${issue?.title || comm.issue_id}".` }],
        };
      }

      case "add_project_doc": {
        if (!args) throw new Error("Arguments are required for add_project_doc");
        const { data: projData, error: pErr } = await supabase
          .from("projects")
          .select("id, name")
          .ilike("name", `%${args.project_name as string}%`)
          .limit(1);

        const proj = projData && projData.length > 0 ? projData[0] : null;

        if (pErr || !proj) throw new Error(`Project "${args.project_name}" not found.`);

        const { data: docData, error: dErr } = await supabase
          .from("project_docs")
          .insert([{
            project_id: proj.id,
            task_id: args.issue_id as string || null,
            title: args.title as string,
            content: args.content as string,
            type: (args.doc_type as string) || "draft"
          }])
          .select()
          .limit(1);

        if (dErr) throw dErr;
        const doc = docData && docData.length > 0 ? docData[0] : null;
        if (!doc) throw new Error("Failed to create document");

        await supabase.from("activities").insert([{
          project_id: proj.id,
          action: "doc_created",
          details: { title: doc.title, type: doc.type }
        }]);

        return {
          content: [{ type: "text", text: `📄 Document "${doc.title}" created successfully (ID: ${doc.id}).` }],
        };
      }

      case "update_project_doc": {
        if (!args) throw new Error("Arguments are required for update_project_doc");
        const updates: any = {};
        if (args.title) updates.title = args.title;
        if (args.content) updates.content = args.content;
        updates.updated_at = new Date().toISOString();

        const { data: docData, error: dErr } = await supabase
          .from("project_docs")
          .update(updates)
          .eq("id", args.doc_id as string)
          .select("id, title, project_id")
          .limit(1);

        if (dErr) throw dErr;
        const doc = docData && docData.length > 0 ? docData[0] : null;
        if (!doc) throw new Error("Document not found or update failed");

        await supabase.from("activities").insert([{
          project_id: doc.project_id,
          action: "doc_updated",
          details: { title: doc.title }
        }]);

        return {
          content: [{ type: "text", text: `✅ Document "${doc.title}" updated successfully.` }],
        };
      }

      case "list_project_docs": {
        if (!args) throw new Error("Arguments are required for list_project_docs");
        const { data: projData, error: pErr } = await supabase
          .from("projects")
          .select("id, name")
          .ilike("name", `%${args.project_name as string}%`)
          .limit(1);

        const proj = projData && projData.length > 0 ? projData[0] : null;

        if (pErr || !proj) throw new Error(`Project "${args.project_name}" not found.`);

        const { data: docs, error: dErr } = await supabase
          .from("project_docs")
          .select("id, title, type, updated_at")
          .eq("project_id", proj.id)
          .order("updated_at", { ascending: false });

        if (dErr) throw dErr;

        const list = (docs || []).map(d => `- **${d.title}** (${d.type}) | ID: ${d.id}`).join("\n");

        return {
          content: [{ type: "text", text: `# Documents for ${proj.name}\n${list || "No documents found."}` }],
        };
      }

      case "get_document_content": {
        if (!args) throw new Error("Arguments are required for get_document_content");
        const { data: docData, error: dErr } = await supabase
          .from("project_docs")
          .select("*")
          .eq("id", args.doc_id as string)
          .limit(1);

        const doc = docData && docData.length > 0 ? docData[0] : null;

        if (dErr || !doc) throw new Error(`Document with ID "${args.doc_id}" not found.`);

        return {
          content: [{ type: "text", text: `# ${doc.title}\nType: ${doc.type}\n\n${doc.content}` }],
        };
      }

      case "list_whiteboards": {
        if (!args) throw new Error("Arguments are required for list_whiteboards");
        const { data: projData, error: pErr } = await supabase
          .from("projects")
          .select("id, name")
          .ilike("name", `%${args.project_name as string}%`)
          .limit(1);

        const proj = projData && projData.length > 0 ? projData[0] : null;

        if (pErr || !proj) throw new Error(`Project "${args.project_name}" not found.`);

        const { data: boards, error: bErr } = await supabase
          .from("whiteboards")
          .select("id, name, updated_at")
          .eq("project_id", proj.id)
          .order("updated_at", { ascending: false });

        if (bErr) throw bErr;

        const list = (boards || []).map(b => `- **${b.name}** | ID: ${b.id}`).join("\n");

        return {
          content: [{ type: "text", text: `# Whiteboards for ${proj.name}\n${list || "No whiteboards found."}` }],
        };
      }

      case "get_whiteboard_data": {
        if (!args) throw new Error("Arguments are required for get_whiteboard_data");
        const { data: boardData, error: bErr } = await supabase
          .from("whiteboards")
          .select("*")
          .eq("id", args.whiteboard_id as string)
          .limit(1);

        const board = boardData && boardData.length > 0 ? boardData[0] : null;

        if (bErr || !board) throw new Error(`Whiteboard with ID "${args.whiteboard_id}" not found.`);

        return {
          content: [{ type: "text", text: JSON.stringify(board.data) }],
        };
      }

      case "add_whiteboard": {
        if (!args) throw new Error("Arguments are required for add_whiteboard");
        const { data: projData, error: pErr } = await supabase
          .from("projects")
          .select("id, name")
          .ilike("name", `%${args.project_name as string}%`)
          .limit(1);

        const proj = projData && projData.length > 0 ? projData[0] : null;

        if (pErr || !proj) throw new Error(`Project "${args.project_name}" not found.`);

        const { data: boardData, error: bErr } = await supabase
          .from("whiteboards")
          .insert([{
            project_id: proj.id,
            name: args.name as string,
            data: args.data || {}
          }])
          .select()
          .limit(1);

        if (bErr) throw bErr;
        const board = boardData && boardData.length > 0 ? boardData[0] : null;

        await supabase.from("activities").insert([{
          project_id: proj.id,
          action: "whiteboard_created",
          details: { name: board.name }
        }]);

        return {
          content: [{ type: "text", text: `🎨 Whiteboard "${board.name}" created successfully (ID: ${board.id}).` }],
        };
      }

      case "generate_mind_map": {
        if (!args) throw new Error("Arguments are required for generate_mind_map");
        let concepts = (args.concepts as string[]) || [];

        if (args.doc_id) {
          const { data: docData } = await supabase.from("project_docs").select("content").eq("id", args.doc_id).limit(1);
          const doc = docData && docData.length > 0 ? docData[0] : null;
          if (doc?.content) {
            // Very simple extraction for now: lines starting with - or *
            const lines = doc.content.split('\n').filter((l: string) => l.trim().startsWith('- ') || l.trim().startsWith('* '));
            if (lines.length > 0) {
              concepts = [...concepts, ...lines.map((l: string) => l.replace(/^[-*]\s+/, '').trim())];
            }
          }
        }

        if (concepts.length === 0) concepts = ["Fase 1", "Fase 2", "MVP", "Requerimientos"];

        const whiteboardData = generateMindMap(args.whiteboard_name as string, concepts);

        const { data: projData } = await supabase.from("projects").select("id").ilike("name", `%${args.project_name as string}%`).limit(1);
        const proj = projData && projData.length > 0 ? projData[0] : null;
        if (!proj) throw new Error("Project not found");

        const { data: boardData, error: bErr } = await supabase
          .from("whiteboards")
          .insert([{
            project_id: proj.id,
            name: args.whiteboard_name as string,
            data: whiteboardData
          }])
          .select()
          .limit(1);

        if (bErr) throw bErr;
        const board = boardData && boardData.length > 0 ? boardData[0] : null;
        if (!board) throw new Error("Failed to create whiteboard");

        return {
          content: [{ type: "text", text: `🧠 Mind Map "${board.name}" generated from ${args.doc_id ? 'document' : 'concepts'}! (ID: ${board.id})` }],
        };
      }

      case "generate_whiteboard_from_mermaid": {
        if (!args) throw new Error("Arguments are required for generate_whiteboard_from_mermaid");
        
        const whiteboardData = mermaidToTldraw(args.mermaid_code as string, args.whiteboard_name as string);

        const { data: projData } = await supabase.from("projects").select("id").ilike("name", `%${args.project_name as string}%`).limit(1);
        const proj = projData && projData.length > 0 ? projData[0] : null;
        if (!proj) throw new Error(`Project matching "${args.project_name}" not found`);

        const { data: boardData, error: bErr } = await supabase
          .from("whiteboards")
          .insert([{
            project_id: proj.id,
            name: args.whiteboard_name as string,
            data: whiteboardData
          }])
          .select()
          .limit(1);

        if (bErr) throw bErr;
        const board = boardData && boardData.length > 0 ? boardData[0] : null;
        if (!board) throw new Error("Failed to create whiteboard");

        return {
          content: [{ type: "text", text: `📊 Whiteboard "${board.name}" generated from Mermaid code! (ID: ${board.id})` }],
        };
      }

      case "import_mermaid_to_whiteboard": {
        if (!args) throw new Error("Arguments are required for import_mermaid_to_whiteboard");
        
        // 1. Fetch existing whiteboard
        const { data: boardData, error: fErr } = await supabase
          .from("whiteboards")
          .select("*")
          .eq("id", args.whiteboard_id as string)
          .limit(1);
        
        const board = boardData && boardData.length > 0 ? boardData[0] : null;
        if (fErr || !board) throw new Error("Whiteboard not found");

        // 2. Generate new shapes
        const newWhiteboardData = mermaidToTldraw(args.mermaid_code as string, board.name);
        
        // 3. Merge stores
        const existingStore = board.data?.store || {};
        const newStore = newWhiteboardData.store;

        // Merge only shapes from new store, keeping document/page/camera etc from existing if they exist
        Object.keys(newStore).forEach(key => {
            if (newStore[key].typeName === 'shape') {
                existingStore[key] = newStore[key];
            }
        });

        const mergedData = {
            ...board.data,
            store: existingStore
        };

        // 4. Update
        const { error: uErr } = await supabase
          .from("whiteboards")
          .update({
            data: mergedData,
            updated_at: new Date().toISOString()
          })
          .eq("id", board.id);

        if (uErr) throw uErr;

        // Return the generated shapes so frontend can merge them directly into the editor
        const newShapes = Object.values(newWhiteboardData.store).filter((s: any) => s.typeName === 'shape');

        return {
          content: [{ 
            type: "text", 
            text: JSON.stringify({ 
              success: true,
              message: `✅ Diagram merged into "${board.name}"!`,
              shapes: newShapes
            })
          }],
        };
      }

      case "update_whiteboard": {
        if (!args) throw new Error("Arguments are required for update_whiteboard");
        const { data: boardData, error: bErr } = await supabase
          .from("whiteboards")
          .update({
            data: args.data,
            updated_at: new Date().toISOString()
          })
          .eq("id", args.whiteboard_id as string)
          .select("id, name, project_id")
          .limit(1);

        if (bErr) throw bErr;
        const board = boardData && boardData.length > 0 ? boardData[0] : null;
        if (!board) throw new Error("Whiteboard not found or update failed");

        await supabase.from("activities").insert([{
          project_id: board.project_id,
          action: "whiteboard_updated",
          details: { name: board.name }
        }]);

        return {
          content: [{ type: "text", text: `✅ Whiteboard "${board.name}" updated successfully.` }],
        };
      }

      case "notebooklm_list": {
        if (!args) throw new Error("Arguments are required");
        const result = await callNotebookLM("notebook_list", {}, args.user_id as string);
        return {
          content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
        };
      }

      case "notebooklm_query": {
        if (!args) throw new Error("Arguments are required");
        const result = await callNotebookLM("notebook_query", {
          notebook_id: args.notebook_id,
          query: args.query
        }, args.user_id as string);
        return {
          content: [{ type: "text", text: `🧠 NotebookLM Response:\n\n${result}` }],
        };
      }

      case "notebooklm_add_doc": {
        if (!args) throw new Error("Arguments are required");
        // 1. Get doc content
        const { data: docData } = await supabase.from("project_docs").select("title, content").eq("id", args.doc_id).limit(1);
        const doc = docData && docData.length > 0 ? docData[0] : null;
        if (!doc) throw new Error("Document not found");

        const result = await callNotebookLM("notebook_add_text", {
          notebook_id: args.notebook_id,
          title: doc.title,
          text: doc.content
        }, args.user_id as string);

        return {
          content: [{ type: "text", text: `✅ Document "${doc.title}" added to NotebookLM.` }],
        };
      }

      case "notebooklm_extract_concept_map": {
        if (!args) throw new Error("Arguments are required");
        const userId = args.user_id as string;
        const notebookId = args.notebook_id as string;
        const docId = args.doc_id as string;

        // 1. Fetch doc content
        const { data: docData } = await supabase.from("project_docs").select("*").eq("id", docId).limit(1);
        const doc = docData && docData.length > 0 ? docData[0] : null;
        if (!doc) throw new Error("Document not found");

        // 2. Add as text source to NotebookLM
        await callNotebookLM("notebook_add_text", {
          notebook_id: notebookId,
          title: doc.title,
          text: doc.content
        }, userId);

        // 3. Query for concepts
        const query = "Analiza este documento y dame una lista de 5 a 8 conceptos o hitos clave para un mapa mental. Responde ÚNICAMENTE con una lista separada por comas (ej: Concepto 1, Concepto 2, ...)";
        const result: any = await callNotebookLM("notebook_query", {
          notebook_id: notebookId,
          query: query
        }, userId);

        return {
          content: [{ type: "text", text: result || "" }],
        };
      }

      case "notebooklm_create": {
        if (!args) throw new Error("Arguments are required");
        const result: any = await callNotebookLM("notebook_create", {
          title: args.title
        }, args.user_id as string);

        return {
          content: [{ type: "text", text: `✨ Notebook "${args.title}" created successfully! ID: ${result.id || 'N/A'}` }],
        };
      }

      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  } catch (error: any) {
    return {
      content: [{ type: "text", text: `❌ Error: ${error.message}` }],
      isError: true,
    };
  }
}

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  return handleTool(name, args);
});

// --- Universal Transport Setup ---

const MCP_MODE = process.env.MCP_MODE || "sse";

if (MCP_MODE === "stdio") {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("MCP Project Central Server running on stdio");
} else {
  // --- Express / SSE Setup ---
  const app = express();
  app.use(cors());
  app.use(express.json());

  const PORT = process.env.PORT || 3000;

  app.use(cors());
  app.use(express.json());

  app.get("/health", (req, res) => res.status(200).json({ status: "ok" }));
  app.get("/", (req, res) => res.status(200).send("MCP Server Active v1.6 (Multi-Method SSE)"));

  const transports = new Map<string, SSEServerTransport>();

  app.all("/sse", async (req, res) => {
    console.log(`>>> [SSE] ${req.method} connection attempt from ${req.ip}`);

    // Headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform, no-store, must-revalidate');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');

    // Use host header to determine message endpoint for SSE
    const host = req.get('host');
    const protocol = req.protocol;
    const messageEndpoint = `${protocol}://${host}/messages`;

    const transport = new SSEServerTransport(messageEndpoint, res);
    const sessionId = transport.sessionId;
    transports.set(sessionId, transport);

    await server.connect(transport);

    res.on("close", () => {
      console.log(`>>> [SSE] Session ${sessionId} closed`);
      setTimeout(() => transports.delete(sessionId), 60000);
    });
  });

  app.post("/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string;
    const transport = transports.get(sessionId);

    if (transport) {
      try {
        await transport.handlePostMessage(req, res);
      } catch (err: any) {
        res.status(500).send(err.message);
      }
    } else {
      res.status(400).send("Session not found");
    }
  });

  // Direct invoke for frontend (simplifies non-standard MCP callers)
  app.post("/messages/invoke", async (req, res) => {
    const { tool, arguments: args } = req.body;
    try {
      const result = await handleTool(tool, args);
      res.json(result);
    } catch (err: any) {
      console.error(`Error invoking tool ${tool}:`, err);
      res.status(500).json({ error: err.message });
    }
  });

  app.listen(Number(PORT), "0.0.0.0", () => {
    console.log(`>>> [v1.6] Ready on port ${PORT}`);
  });
}
