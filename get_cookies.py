import json, sys
cj = None
try:
    import browser_cookie3
except Exception:
    print(json.dumps({"error": "browser-cookie3 not installed. Run: pip3 install browser-cookie3"}))
    sys.exit(1)

for loader in [
    lambda: browser_cookie3.arc(domain_name="familysearch.org"),
    lambda: browser_cookie3.chrome(domain_name="familysearch.org"),
    lambda: browser_cookie3.firefox(domain_name="familysearch.org"),
    lambda: browser_cookie3.safari(domain_name="familysearch.org"),
    lambda: browser_cookie3.edge(domain_name="familysearch.org"),
    lambda: browser_cookie3.brave(domain_name="familysearch.org"),
    lambda: browser_cookie3.opera(domain_name="familysearch.org"),
]:
    try:
        cj = loader()
        break
    except Exception:
        continue

if cj is None:
    print(json.dumps({"error": "No browser with FamilySearch cookies found. Log in at familysearch.org first."}))
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
