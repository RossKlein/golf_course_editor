import { describe, expect, it } from "vitest";
import { angleFromHours, dateOfDay, datesOfDeclination, declinationOnDay, describeHours, hoursFromAngle } from "./sun";

describe("the sun in words", () => {
  it("has the June solstice at 23.44 degrees and the December one at the opposite", () => {
    expect(declinationOnDay(172)).toBeCloseTo(23.44, 1);
    expect(declinationOnDay(355)).toBeCloseTo(-23.44, 1);
  });

  it("is zero at the equinoxes, about March 20 and September 22", () => {
    expect(Math.abs(declinationOnDay(79))).toBeLessThan(1);
    expect(Math.abs(declinationOnDay(265))).toBeLessThan(1);
  });

  it("names a day of the year", () => {
    expect(dateOfDay(1)).toBe("Jan 1");
    expect(dateOfDay(32)).toBe("Feb 1");
    expect(dateOfDay(172)).toBe("Jun 21");
    expect(dateOfDay(365)).toBe("Dec 31");
  });

  it("finds the two dates for a declination, one each side of the solstice", () => {
    const [a, b] = datesOfDeclination(23.44);
    expect(a).toMatch(/^Jun/);
    expect(b).toMatch(/^Jun/);
    const [spring, autumn] = datesOfDeclination(0);
    expect(spring).toMatch(/^Mar/);
    expect(autumn).toMatch(/^Sep/);
    const [winter] = datesOfDeclination(-23.44);
    expect(winter).toMatch(/^Dec/);
    const [apr, aug] = datesOfDeclination(declinationOnDay(115)); // Apr 25
    expect(apr).toBe("Apr 25");
    expect(aug).toMatch(/^Aug/);
  });

  it("is a time from solar noon at 15 degrees an hour", () => {
    expect(hoursFromAngle(-36)).toBeCloseTo(-2.4);
    expect(angleFromHours(-2.4)).toBeCloseTo(-36);
  });

  it("describes a time", () => {
    expect(describeHours(-2.4)).toBe("2.4 h before solar noon");
    expect(describeHours(1)).toBe("1 h after solar noon");
    expect(describeHours(0)).toBe("solar noon");
  });
});
