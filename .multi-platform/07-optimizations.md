# Optimizations — iPad View Size Increase

## Applied Optimizations

### 1. Single Media Query Block
Rather than multiple separate queries for each iPad model, a single `min-width: 744px` covers all iPad models from mini upward. Reduces CSS specificity complexity.

### 2. Cascade Ordering
iPad block placed AFTER portrait block — this is critical. Without this ordering, portrait rules (lower specificity) would incorrectly override iPad rules in portrait orientation.

### 3. zoom vs transform: scale
CSS `zoom` used (not `transform: scale`) because:
- `zoom` participates in normal flow layout — scroll containers resize correctly
- `transform: scale` on `html` would require compensating for layout collapse

## No Further Optimization Needed
The change is 15 lines of CSS. No bundle size impact, no runtime cost.
