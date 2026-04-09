#!/usr/bin/env python3
"""Debug script to test MCP headers flow end-to-end."""

import asyncio
import httpx
from mcp.shared._httpx_utils import create_mcp_http_client
from mcp.client.streamable_http import streamable_http_client, StreamableHTTPTransport

async def test_mcp_headers():
    """Test if Authorization header reaches the MCP server."""
    
    print("=" * 70)
    print("MCP HEADERS DEBUG TEST")
    print("=" * 70)
    
    # Simulate user's configuration
    config_headers = {
        "Accept": "application/json, text/event-stream",
        "Authorization": "Bearer mcp_NBnq-2aDEXPw_d_K8Nzc3YjXakXkXJneB7dRnfZiK2U"
    }
    
    # Test 1: Create httpx client with headers
    print("\n[TEST 1] Create httpx client with headers")
    timeout = httpx.Timeout(30.0)
    http_client = create_mcp_http_client(
        headers=config_headers,
        timeout=timeout,
    )
    
    print(f"  Client type: {type(http_client).__name__}")
    print(f"  Client headers: {http_client.headers}")
    
    has_auth = any(k.lower() == "authorization" for k in http_client.headers.keys())
    print(f"  Has Authorization: {has_auth}")
    
    # Test 2: Check what _prepare_headers returns
    print("\n[TEST 2] Check _prepare_headers() from StreamableHTTPTransport")
    transport = StreamableHTTPTransport("http://192.168.1.100:8888/mcp")
    mcp_headers = transport._prepare_headers()
    print(f"  MCP-prepared headers: {mcp_headers}")
    print(f"  Note: These don't include Authorization - that's from http_client")
    
    # Test 3: Simulate what happens when building a request
    print("\n[TEST 3] Simulate request header merging")
    request = http_client.build_request(
        "POST",
        "http://192.168.1.100:8888/mcp",
        json={"test": "data"},
        headers=mcp_headers,  # MCP headers overlay
    )
    
    print(f"  Final request headers:")
    for name, value in request.headers.items():
        if name.lower() in ["authorization", "accept", "content-type"]:
            val_display = value[:40] + "..." if len(value) > 40 else value
            print(f"    {name}: {val_display}")
    
    has_auth_in_request = any(
        k.lower() == "authorization" for k in request.headers.keys()
    )
    print(f"  Has Authorization in final request: {has_auth_in_request}")
    
    # Test 4: Try actual connection (if Superset is available)
    print("\n[TEST 4] Try actual Superset MCP connection")
    try:
        async with streamable_http_client(
            url="http://192.168.1.100:8888/mcp",
            http_client=http_client,
        ) as (read_stream, write_stream, get_session_id):
            print(f"  ✓ Connected to Superset MCP!")
            print(f"  Session ID: {get_session_id()}")
    except httpx.HTTPStatusError as e:
        if e.response.status_code == 401:
            print(f"  ✗ Got 401 Unauthorized - Authorization header may not be sent")
        else:
            print(f"  ✗ Got {e.response.status_code}: {e}")
    except Exception as e:
        print(f"  ✗ Connection failed: {e}")
    finally:
        await http_client.aclose()
    
    print("\n" + "=" * 70)
    print("RECOMMENDATIONS:")
    print("=" * 70)
    print("""
If you got 401 Unauthorized despite having Authorization in this test:
1. Check if Superset token is actually valid
2. Check Superset/nginx logs for what headers were actually received
3. Try with curl using same token to verify it's valid
4. Check if there's an nginx proxy removing Authorization header

If headers look correct here but fail in CoPaw:
1. Check if environment variables are altering the token  
2. Check if there's a middleware removing headers
3. Ensure CoPaw isn't caching stale client configuration
""")

if __name__ == "__main__":
    asyncio.run(test_mcp_headers())
