import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * Phase 5T-6A (docs/phase5t6_section_drag_drop_indicator_design.md §8/§9,
 * docs/phase5t_tree-interaction-move-design.md §18): CSS static-verification
 * regression tests locking in the fix for the section D&D before/after/
 * inside drop-indicator visibility bug.
 *
 * Root cause (established by Phase 5T-6D's audit, confirmed against the
 * user's own actual settings.json): `treeKindHighlight.sectionMode:
 * "stripe"` applies an ALWAYS-ON `box-shadow` to every section row via a
 * higher-CSS-specificity selector than `.unified-outliner-drop-before` /
 * `.unified-outliner-drop-after` / `.unified-outliner-drop-inside`. Since
 * `box-shadow` is a single, non-cumulative property, the higher-specificity
 * always-on rule silently and completely wins that competition, making the
 * before/after edge line (and inside's own left accent bar) invisible on
 * every section row whenever that setting is active — independent of
 * cursor position. The same class of collision was found (and fixed in the
 * same commit) for `sectionMode: "subtle"`'s own always-on
 * `background-color`, which would otherwise have silently replaced the
 * inside indicator's own `background-color` tint.
 *
 * The fix moves all three drop indicators off both `box-shadow` and
 * row-level `background-color` entirely, onto dedicated `::before`/
 * `::after` pseudo-elements. A pseudo-element is a distinct generated box
 * from its host `.tree-item-self` — a selector that only ever targets
 * `.tree-item-self` itself (every kind-highlight rule in this file) can
 * never apply to `.tree-item-self::before`/`::after` at all, regardless of
 * specificity — so no always-on per-kind decoration (stripe, subtle, or
 * anything added later) can ever collide with these indicators again.
 *
 * These tests parse styles.css into a flat list of (selector, body) rule
 * pairs (a small purpose-built extractor — no CSS parser dependency exists
 * in this project's package.json, and adding one for a single regression
 * check would be disproportionate) and assert on the parsed structure
 * rather than raw substrings, so a regression that reintroduces
 * `box-shadow`/row-level `background-color` on the wrong selector — even
 * reformatted or reordered — is caught.
 */

interface CssRule {
  selector: string;
  body: string;
}

/**
 * Flattens styles.css into top-level (selector, body) rule pairs. Nested
 * `@supports`/`@media` blocks are recursed into (their own inner rules are
 * yielded as if top-level); `@keyframes` blocks are skipped entirely (their
 * "selectors" are keyframe percentages/from/to, not CSS selectors, and are
 * irrelevant to every check in this file). Comments are stripped before
 * scanning so a selector-like string inside a comment can never be
 * misparsed as a real rule header.
 */
function stripComments(css: string): string {
  // Removing every /* ... */ block comment FIRST (rather than trying to
  // skip over them mid-scan below) means the brace-matching walk never has
  // to special-case "am I inside a comment right now" at every single
  // character position — a comment can never straddle a header/body
  // boundary in the stripped text, so the walk below can stay a simple,
  // comment-unaware brace scanner.
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function extractRules(css: string): CssRule[] {
  const rules: CssRule[] = [];
  const n = css.length;
  let i = 0;

  while (i < n) {
    if (css[i] === "}") {
      i++;
      continue;
    }
    const headerStart = i;
    while (i < n && css[i] !== "{" && css[i] !== "}") i++;
    const header = css.slice(headerStart, i).trim();
    if (i >= n || css[i] === "}") continue;
    // css[i] === "{"
    i++;
    const bodyStart = i;
    let depth = 1;
    while (i < n && depth > 0) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
      if (depth > 0) i++;
    }
    const body = css.slice(bodyStart, i);
    i++; // consume the matching closing brace
    if (!header) continue;
    if (header.startsWith("@supports") || header.startsWith("@media")) {
      rules.push(...extractRules(body));
    } else if (header.startsWith("@keyframes") || header.startsWith("@font-face")) {
      // not a selector rule — irrelevant to indicator/highlight checks.
    } else {
      rules.push({ selector: header, body });
    }
  }
  return rules;
}

/** True for a selector that targets a `::before`/`::after` generated box rather than the row element itself. */
function isPseudoElementSelector(selector: string): boolean {
  return selector.includes("::before") || selector.includes("::after");
}

describe("styles.css drop-indicator / section-highlight CSS property isolation (Phase 5T-6A)", () => {
  const stylesCss = readFileSync(path.resolve(__dirname, "../styles.css"), "utf-8");
  const rules = extractRules(stripComments(stylesCss));

  function rulesFor(classNeedle: string): CssRule[] {
    return rules.filter((r) => r.selector.includes(classNeedle));
  }

  const dropIndicatorRules = rules.filter(
    (r) =>
      r.selector.includes(".unified-outliner-drop-before") ||
      r.selector.includes(".unified-outliner-drop-after") ||
      r.selector.includes(".unified-outliner-drop-inside")
  );
  const rowLevelDropRules = dropIndicatorRules.filter((r) => !isPseudoElementSelector(r.selector));
  const pseudoDropRules = dropIndicatorRules.filter((r) => isPseudoElementSelector(r.selector));

  it("parses at least one rule for each of the 3 drop-indicator classes and the section-highlight stripe/subtle rules (sanity check on the extractor itself)", () => {
    expect(rulesFor(".unified-outliner-drop-before").length).toBeGreaterThan(0);
    expect(rulesFor(".unified-outliner-drop-after").length).toBeGreaterThan(0);
    expect(rulesFor(".unified-outliner-drop-inside").length).toBeGreaterThan(0);
    expect(rulesFor('[data-section-highlight="stripe"]').length).toBeGreaterThan(0);
    expect(rulesFor('[data-section-highlight="subtle"]').length).toBeGreaterThan(0);
    expect(pseudoDropRules.length).toBeGreaterThan(0);
  });

  it("no rule targeting the drop-indicator classes on the ROW itself (not a ::before/::after pseudo-element) declares box-shadow OR background-color — these are the exact 2 regressions the Phase 5T-6D/5T-6A bug represents (box-shadow vs stripe, background-color vs subtle)", () => {
    expect(rowLevelDropRules.length).toBeGreaterThan(0);
    for (const rule of rowLevelDropRules) {
      expect(rule.body, `rule "${rule.selector}"`).not.toMatch(/box-shadow\s*:/);
      expect(rule.body, `rule "${rule.selector}"`).not.toMatch(/background-color\s*:/);
    }
  });

  it("the section-highlight 'stripe' rule (the always-on per-kind decoration that caused the box-shadow conflict) still exists and still uses box-shadow — this fix must not have disabled or weakened that decoration itself", () => {
    const stripeRowRule = rulesFor('[data-section-highlight="stripe"]').find((r) =>
      r.selector.includes('.tree-item-self[data-kind="section"]')
    );
    expect(stripeRowRule).toBeDefined();
    expect(stripeRowRule!.body).toMatch(/box-shadow\s*:/);
  });

  it("the section-highlight 'subtle' rule (the always-on per-kind decoration that caused the background-color conflict) still exists and still uses background-color — this fix must not have disabled or weakened that decoration itself", () => {
    const subtleRowRule = rulesFor('[data-section-highlight="subtle"]').find((r) =>
      r.selector.includes('.tree-item-self[data-kind="section"]')
    );
    expect(subtleRowRule).toBeDefined();
    expect(subtleRowRule!.body).toMatch(/background-color\s*:/);
  });

  it("the before/after ::after pseudo-element rule draws a full-width edge bar via background-color + position + inset offsets, uses --uo-current-color, is pointer-events: none, and never uses box-shadow", () => {
    const beforeAfterAfterRule = rules.find(
      (r) =>
        r.selector.includes(".unified-outliner-drop-before::after") &&
        r.selector.includes(".unified-outliner-drop-after::after")
    );
    expect(beforeAfterAfterRule).toBeDefined();
    const body = beforeAfterAfterRule!.body;
    expect(body).toMatch(/position\s*:\s*absolute/);
    expect(body).toMatch(/background-color\s*:\s*var\(--uo-current-color\)/);
    expect(body).toMatch(/pointer-events\s*:\s*none/);
    expect(body).toMatch(/height\s*:/);
    expect(body).not.toMatch(/box-shadow\s*:/);

    const topRule = rules.find((r) => r.selector === ".unified-outliner-drop-before::after");
    const bottomRule = rules.find((r) => r.selector === ".unified-outliner-drop-after::after");
    expect(topRule?.body).toMatch(/top\s*:\s*0/);
    expect(bottomRule?.body).toMatch(/bottom\s*:\s*0/);
  });

  it("the inside ::before pseudo-element rule draws the full-row tint via background-color, is pointer-events: none, and never uses box-shadow — this is the fix for the background-color-vs-'subtle' collision", () => {
    const insideBeforeRule = rules.find((r) => r.selector === ".unified-outliner-drop-inside::before");
    expect(insideBeforeRule).toBeDefined();
    const body = insideBeforeRule!.body;
    expect(body).toMatch(/position\s*:\s*absolute/);
    expect(body).toMatch(/background-color\s*:\s*rgba\(91,\s*87,\s*209,\s*0\.25\)/);
    expect(body).toMatch(/pointer-events\s*:\s*none/);
    expect(body).not.toMatch(/box-shadow\s*:/);
    // Full-row coverage: all 4 inset offsets pinned to 0.
    expect(body).toMatch(/top\s*:\s*0/);
    expect(body).toMatch(/right\s*:\s*0/);
    expect(body).toMatch(/bottom\s*:\s*0/);
    expect(body).toMatch(/left\s*:\s*0/);
  });

  it("the color-mix() progressive enhancement for the inside tint targets the SAME ::before selector (not the row-level class) — the @supports override must not reintroduce a row-level background-color", () => {
    const colorMixIdx = stylesCss.indexOf("color-mix(in srgb, red 25%, transparent)");
    expect(colorMixIdx).toBeGreaterThan(-1);
    const nextRuleSlice = stylesCss.slice(colorMixIdx, colorMixIdx + 400);
    expect(nextRuleSlice).toContain(".unified-outliner-drop-inside::before");
    expect(nextRuleSlice).toContain("color-mix(in srgb, var(--uo-current-color) 25%, transparent)");
  });

  it("the inside ::after pseudo-element rule draws a left accent bar via background-color + width (geometrically distinct from before/after's height-based edge bar and from inside's own full-row ::before tint), uses --uo-current-color, is pointer-events: none, and never uses box-shadow", () => {
    const insideAfterRule = rules.find((r) => r.selector === ".unified-outliner-drop-inside::after");
    expect(insideAfterRule).toBeDefined();
    const body = insideAfterRule!.body;
    expect(body).toMatch(/position\s*:\s*absolute/);
    expect(body).toMatch(/background-color\s*:\s*var\(--uo-current-color\)/);
    expect(body).toMatch(/pointer-events\s*:\s*none/);
    expect(body).toMatch(/width\s*:/);
    expect(body).not.toMatch(/box-shadow\s*:/);
  });

  it("position: relative is scoped to only the 3 transient drop-indicator classes, not applied unconditionally to every .tree-item-self row", () => {
    const positionRule = rowLevelDropRules.find(
      (r) =>
        r.selector.includes(".unified-outliner-drop-before") &&
        r.selector.includes(".unified-outliner-drop-after") &&
        r.selector.includes(".unified-outliner-drop-inside")
    );
    expect(positionRule).toBeDefined();
    expect(positionRule!.body).toMatch(/position\s*:\s*relative/);
    // Regression guard: no bare, unconditional ".tree-item-self { position: ... }" rule exists.
    const bareTreeItemSelfRule = rules.find((r) => r.selector.trim() === ".tree-item-self");
    expect(bareTreeItemSelfRule).toBeUndefined();
  });

  it("no CSS property is declared by BOTH a kind-highlight rule (subtle/stripe/hover, section or list) and any ROW-LEVEL drop-indicator rule — the general non-collision invariant this whole fix exists to establish", () => {
    const kindHighlightRules = rules.filter(
      (r) => r.selector.includes("data-section-highlight") || r.selector.includes("data-list-highlight")
    );
    expect(kindHighlightRules.length).toBeGreaterThan(0);

    function declaredProperties(body: string): Set<string> {
      const props = new Set<string>();
      for (const decl of body.split(";")) {
        const m = decl.match(/^\s*([a-zA-Z-]+)\s*:/);
        if (m) props.add(m[1].trim());
      }
      return props;
    }

    for (const kindRule of kindHighlightRules) {
      const kindProps = declaredProperties(kindRule.body);
      for (const dropRule of rowLevelDropRules) {
        const dropProps = declaredProperties(dropRule.body);
        const shared = [...dropProps].filter((p) => kindProps.has(p));
        expect(
          shared,
          `rule "${dropRule.selector}" shares propert(y/ies) [${shared}] with kind-highlight rule "${kindRule.selector}"`
        ).toEqual([]);
      }
    }
  });

  it("sectionMode still offers exactly 'subtle' | 'stripe' | 'off' (settingsDefaults.ts type unchanged) — the fix must remain correct for all 3, not just stripe", () => {
    const settingsTs = readFileSync(path.resolve(__dirname, "../src/settingsDefaults.ts"), "utf-8");
    expect(settingsTs).toContain('sectionMode: "subtle" | "stripe" | "off";');
  });

  it("computeDropMode's edge-zone thresholds (top third -> before, bottom third -> after, middle third -> inside) are unchanged — Phase 5T-6A explicitly forbids touching zone geometry", () => {
    const viewTs = readFileSync(path.resolve(__dirname, "../src/view/OutlineTreeView.ts"), "utf-8");
    const start = viewTs.indexOf("private computeDropMode(");
    expect(start).toBeGreaterThan(-1);
    const end = viewTs.indexOf("\n  }", start);
    const body = viewTs.slice(start, end);
    expect(body).toContain("ratio < 1 / 3");
    expect(body).toContain('return "before"');
    expect(body).toContain("ratio > 2 / 3");
    expect(body).toContain('return "after"');
    expect(body).toContain('return "inside"');
  });

  it("relocateSection/relocateListSubtree drop-mode semantics (before/after/inside insertion points) and canDropOn's self/descendant rejection are untouched — Phase 5T-6A is CSS-only", () => {
    const relocateSectionTs = readFileSync(path.resolve(__dirname, "../src/move/relocateSection.ts"), "utf-8");
    expect(relocateSectionTs).toContain("insertBeforeLine = target.range.startLine");
    expect(relocateSectionTs).toContain("insertBeforeLine = target.range.endLine + 1");
    expect(relocateSectionTs).toContain("isSelfOrDescendant(doc, target, source)");
  });
});
