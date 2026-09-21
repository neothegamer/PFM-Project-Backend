const categorize = require("../utils/categorize");

describe("categorizeTransaction", () => {
  test.each([
    ["STARBUCKS #4521", "Food and Drink"],
    ["Uber 063015 SF**POOL**", "Transportation"],
    ["Lyft ride", "Transportation"],
    ["AMAZON MKTPLACE", "Shopping"],
    ["Netflix", "Entertainment"],
    ["Monthly rent payment", "Housing"],
    ["Comcast Internet", "Utilities"],
    ["Electric bill", "Utilities"],
    ["CVS Pharmacy #1234", "Health"],
    ["ACME PAYROLL DIRECT DEPOSIT", "Income"],
  ])("categorizes %s as %s", (name, expected) => {
    expect(categorize(name)).toBe(expected);
  });

  test("matching is case-insensitive", () => {
    expect(categorize("starbucks")).toBe("Food and Drink");
    expect(categorize("NETFLIX")).toBe("Entertainment");
  });

  test("the first matching rule wins when a name matches several categories", () => {
    // "uber eats" is in Food and Drink, which is checked before Transportation's "uber".
    expect(categorize("Uber Eats order")).toBe("Food and Drink");
    // "coffee" (Food and Drink) beats "shell" (Transportation).
    expect(categorize("Shell coffee")).toBe("Food and Drink");
  });

  test("returns null when nothing matches, so the caller can pick a fallback", () => {
    expect(categorize("Random Store")).toBeNull();
    expect(categorize("XYZ Corp")).toBeNull();
  });

  test("returns null for empty or missing names", () => {
    expect(categorize("")).toBeNull();
    expect(categorize(null)).toBeNull();
    expect(categorize(undefined)).toBeNull();
  });

  // Known limitation: the rules use substring matching, so short keywords match inside longer
  // words. These are the cases the word-boundary fix should make pass (see BACKEND_CHECKLIST.md).
  test.todo('does not categorize "Enterprise Rent-A-Car" as Housing');
  test.todo('does not categorize "Current account fee" as Housing');
  test.todo('does not categorize "Metropolitan Museum" as Transportation');
  test.todo('does not categorize "Targeted ads Inc" as Shopping');
});
