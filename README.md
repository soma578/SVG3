# SVG3 community property UI v2.1

Small follow-up to v2.

Change:
- Preserve upstream custom property HTML.
- Remove only the generic leading table row whose two cells are exactly
  `name` and `value`.
- Other table headers and domain-specific rows remain untouched.

Apply from repository root:

```bash
unzip -o /path/to/svg3_community_property_ui_v2_1.zip
find . -type f -name '*:Zone.Identifier' -delete

node frontend/apply-community-property-ui-v2-1.mjs
node frontend/verify-community-property-ui-v2-1.mjs

cd frontend
npm run assets:prepare -- --path webapp
npm run assets:check
npm run dev
```
