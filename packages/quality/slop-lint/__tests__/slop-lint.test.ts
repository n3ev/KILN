import { describe, expect, it } from "vitest";
import { formatForRewrite, slopLint } from "../index.js";
import { THRESHOLDS } from "../rules.js";
import { splitSentences } from "../text.js";

const rules = (text: string, opts = {}): string[] =>
  slopLint(text, opts).findings.map((f) => f.rule);

describe("sentence splitting", () => {
  it("does not split on abbreviations, which would wreck every length statistic", () => {
    const s = splitSentences("The lid is approx. 40mm across. It weighs 120g.");
    expect(s).toHaveLength(2);
    expect(s[0]?.text).toBe("The lid is approx. 40mm across.");
  });

  it("does not split on initials", () => {
    expect(splitSentences("Designed by J. Morris in Leeds.")).toHaveLength(1);
  });

  it("does not split inside decimals", () => {
    expect(splitSentences("It costs 12.50 to make.")).toHaveLength(1);
  });

  it("preserves offsets so findings can be highlighted in place", () => {
    const text = "First one. Second one.";
    const [, second] = splitSentences(text);
    expect(text.slice(second?.start ?? 0, second?.end ?? 0)).toBe("Second one.");
  });
});

describe("banned phrases", () => {
  it("catches the seed dictionary", () => {
    expect(rules("We elevate your morning ritual.")).toContain("banned-phrase");
    expect(rules("A true game-changer for slow living.")).toContain("banned-phrase");
    expect(rules("Let us delve into the details.")).toContain("banned-phrase");
  });

  it("respects word boundaries", () => {
    // "journey" is banned; "journeyman" is a real word and must not trip it.
    expect(rules("A journeyman potter shaped this.")).not.toContain("banned-phrase");
    expect(rules("Start your journey today.")).toContain("banned-phrase");
  });

  it("catches shape-based tells, not just strings", () => {
    expect(rules("It's not just a holder, it's a ritual.")).toContain("banned-phrase");
    expect(rules("Whether you're a beginner or an expert, this fits.")).toContain("banned-phrase");
    expect(rules("Not only does it burn evenly but also it lasts.")).toContain("banned-phrase");
  });

  it("honours brand-specific banned words from the voice charter", () => {
    expect(rules("Our artisan vibe is strong.", { extraBanned: ["vibe"] })).toContain("banned-phrase");
  });
});

describe("structural tells", () => {
  it("flags three consecutive sentences of near-equal length", () => {
    const text =
      "The clay is fired at twelve hundred degrees. " +
      "The glaze is mixed by hand each morning. " +
      "The kiln is opened after two full days.";
    expect(rules(text)).toContain("sentence-length-uniformity");
  });

  it("accepts varied rhythm", () => {
    const text =
      "The clay is fired at twelve hundred degrees in a gas kiln that takes two days to cool. " +
      "It works. " +
      "Every batch loses one or two pieces to the heat, which is why the seconds shelf exists.";
    expect(rules(text)).not.toContain("sentence-length-uniformity");
  });

  it("flags em-dash overuse relative to length", () => {
    const text = "Short — one. Another — two. A third — three. And — four.";
    expect(rules(text)).toContain("em-dash-density");
  });

  it("allows a single em-dash in short copy", () => {
    expect(rules("The kiln runs hot — hotter than most studios manage.")).not.toContain("em-dash-density");
  });

  it("flags tricolon density", () => {
    const text =
      "It is cheap, fast, and light. We ship boxes, jars, and lids. " +
      "You get clay, glaze, and grit. Choose red, blue, or green.";
    expect(rules(text)).toContain("tricolon-density");
  });

  it("flags repeated participial paragraph openers", () => {
    const text = [
      "Combining heat and time, the kiln does its work.",
      "",
      "Drawing on twenty years, the potter shapes each lid.",
      "",
      "Building on that method, the studio now fires weekly.",
      "",
      "Designed for daily use, the holder sits flat.",
    ].join("\n");
    expect(rules(text)).toContain("participial-opener");
  });

  it("permits up to the documented number of participial openers", () => {
    const text = ["Combining heat and time, the kiln works.", "", "Plain second paragraph here."].join("\n");
    expect(rules(text)).not.toContain("participial-opener");
    expect(THRESHOLDS.participialOpeners).toBe(2);
  });

  it("flags rhetorical question openers", () => {
    expect(rules("Tired of smoky rooms? This holder catches the ash.")).toContain(
      "rhetorical-question-opener",
    );
  });

  it("flags listicle-shaped documents", () => {
    const text = ["# One", "", "Body.", "", "## Two", "", "## Three", "", "## Four"].join("\n");
    expect(rules(text)).toContain("heading-body-ratio");
  });
});

describe("placeholders and emoji", () => {
  it("blocks every placeholder form", () => {
    for (const bad of [
      "Lorem ipsum dolor sit.",
      "TODO: write this properly.",
      "Contact [insert email here] now.",
      "Welcome to Your Brand.",
      "Email us at hi@example.com.",
      "Hello {{first_name}}.",
      "Price: TBD",
    ]) {
      expect(rules(bad), bad).toContain("placeholder-residue");
    }
  });

  it("blocks emoji unless the voice charter enables them", () => {
    expect(rules("Fresh batch out of the kiln 🔥")).toContain("emoji-in-body");
    expect(rules("Fresh batch out of the kiln 🔥", { emojiAllowed: true })).not.toContain("emoji-in-body");
  });
});

describe("clean copy", () => {
  it("passes prose written like a person wrote it", () => {
    const text = [
      "Each holder is thrown on a wheel in a converted garage in Sheffield, then",
      "fired twice. The second firing is what gives the glaze its uneven pooling",
      "at the base.",
      "",
      "They hold a standard 3mm incense stick. Ash falls into the well rather than",
      "onto the shelf, which is the entire reason the well is there.",
      "",
      "Two firings mean roughly one piece in nine cracks. Those go on the seconds",
      "shelf at half price.",
    ].join("\n");

    const result = slopLint(text);
    expect(result.findings.filter((f) => f.severity === "block")).toEqual([]);
    expect(result.passed).toBe(true);
  });
});

describe("rewrite instructions", () => {
  it("quotes the offending span rather than describing it", () => {
    const text = "We elevate your morning ritual.";
    const message = formatForRewrite(text, slopLint(text));
    expect(message).toContain('"elevate your"');
    expect(message).toContain("Fix:");
  });

  it("is empty when the copy passed", () => {
    expect(formatForRewrite("A plain sentence about clay.", slopLint("A plain sentence about clay."))).toBe("");
  });

  it("reports spans that actually index the offending text", () => {
    const text = "This is a game-changer for the studio.";
    const finding = slopLint(text).findings.find((f) => f.rule === "banned-phrase");
    expect(text.slice(finding?.span.start ?? 0, finding?.span.end ?? 0).toLowerCase()).toBe("game-changer");
  });
});
