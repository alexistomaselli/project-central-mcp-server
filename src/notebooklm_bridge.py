
import sys
import json
import asyncio
from notebooklm_mcp.server import NotebookLMServer
from mcp.server.fastmcp import FastMCP

# This is a simplified bridge that uses FastMCP tools directly
async def run_tool(command, args, cookies_json):
    # Initialize the server with cookies if provided
    # Note: notebooklm-mcp usually reads from a file or environment.
    # For this bridge, we'll try to set up the session dynamically.
    
    server = NotebookLMServer()
    # Mocking the context or just using the tools directly if possible.
    # Since NotebookLMServer is a FastMCP app, we can access its tools.
    
    # Map command to tool function
    tools = {
        "notebook_list": server.notebook_list,
        "notebook_create": server.notebook_create,
        "notebook_query": server.notebook_query,
        "notebook_add_text": server.notebook_add_text,
        "audio_overview_create": server.audio_overview_create
    }
    
    if command not in tools:
        return {"error": f"Unknown command: {command}"}
    
    try:
        # In a real scenario, we'd need to inject cookies into the session
        # here. notebooklm-mcp uses browser automation.
        # We might need to save cookies to a temporary file for undetected-chromedriver.
        if cookies_json:
            with open("/tmp/notebooklm_cookies.json", "w") as f:
                f.write(cookies_json)
            # The library might need an environment variable to find this
            import os
            os.environ["NOTEBOOKLM_COOKIES_PATH"] = "/tmp/notebooklm_cookies.json"

        result = await tools[command](**args)
        return {"result": result}
    except Exception as e:
        return {"error": str(e)}

async def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "No command provided"}))
        return

    input_data = sys.stdin.read()
    data = json.loads(input_data)
    
    command = sys.argv[1]
    args = data.get("args", {})
    cookies = data.get("cookies", "")
    
    result = await run_tool(command, args, cookies)
    print(json.dumps(result))

if __name__ == "__main__":
    asyncio.run(main())
