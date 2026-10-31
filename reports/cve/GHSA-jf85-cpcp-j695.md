## CVE-2019-10744 (GHSA-jf85-cpcp-j695) Report Update

**Vulnerability**: GHSA-jf85-cpcp-j695
**Affected Package**: `lodash`
**Old Version**: `4.17.11`
**New Version**: `4.17.12`

**Fix Applied**: Updated `lodash` dependency in `targets/vuln-app/package.json` from `4.17.11` to `4.17.12`.

**Scan Result After Fix**: `GHSA-jf85-cpcp-j695` and its aliases are no longer listed for `lodash`.

### Full Scan Result

```json
{
  "path": "targets/vuln-app",
  "scanned": 2,
  "skippedNonPinned": [],
  "vulnerable": [
    {
      "name": "lodash",
      "version": "4.17.12",
      "vulnIds": [
        "GHSA-29mw-wpgm-hmr9",
        "GHSA-35jh-r3h4-6jhm",
        "GHSA-f23m-r3pf-42rh",
        "GHSA-p6mc-m468-83gw",
        "GHSA-r5fr-rjxr-66jc",
        "GHSA-xxjr-mmjv-4gpg"
      ]
    },
    {
      "name": "minimist",
      "version": "1.2.0",
      "vulnIds": [
        "GHSA-vh95-rmgr-6w4m",
        "GHSA-xvch-5gv4-984h"
      ]
    }
  ],
  "note": "Ids are OSV/GHSA ids; call cve_details for each to get CVE aliases and fixed versions."
}
```