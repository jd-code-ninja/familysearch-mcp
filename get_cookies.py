import json, sys
try:
    import browser_cookie3
    cj = browser_cookie3.arc(domain_name="familysearch.org")
except:
    try:
        cj = browser_cookie3.chrome(domain_name="familysearch.org")
    except:
        try:
            cj = browser_cookie3.firefox(domain_name="familysearch.org")
        except:
            print(json.dumps({"error": "No browser with FamilySearch cookies found"}))
            sys.exit(1)

cookies = []
for c in cj:
    cookies.append({
        "name": c.name,
        "value": c.value,
        "domain": c.domain or ".familysearch.org",
        "path": c.path or "/",
        "expires": c.expires if c.expires else None,
    })

has_session = any(c["name"] == "fssessionid" for c in cookies)
if not has_session:
    print(json.dumps({"error": "fssessionid not found in browser cookies - log in to FamilySearch in your browser first"}))
    sys.exit(1)

print(json.dumps(cookies))
