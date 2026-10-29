// Synthetic Indian name lists for bulk generation (T-013's people section
// draws thousands of students/guardians from these; never real data).
export const FIRST_NAMES_MALE = [
  "Aarav", "Vihaan", "Arjun", "Sai", "Reyansh", "Krishna", "Ishaan", "Rohan",
  "Aditya", "Vivaan", "Kabir", "Dhruv", "Yash", "Aryan", "Shaurya", "Om",
  "Rudra", "Atharv", "Pranav", "Darsh",
];

export const FIRST_NAMES_FEMALE = [
  "Ananya", "Diya", "Priya", "Saanvi", "Aadhya", "Kiara", "Myra", "Anika",
  "Ira", "Riya", "Avni", "Sara", "Pari", "Navya", "Ishita", "Siya", "Tara",
  "Zara", "Kavya", "Meera",
];

export const LAST_NAMES = [
  "Sharma", "Verma", "Gupta", "Mehta", "Patel", "Shah", "Singh", "Kumar",
  "Reddy", "Nair", "Iyer", "Rao", "Joshi", "Chopra", "Malhotra", "Kapoor",
  "Bhat", "Agarwal", "Desai", "Pillai",
];

export function pickName(
  rng: () => number,
  gender: "male" | "female" | "other",
): { firstName: string; lastName: string } {
  const firstNamePool = gender === "female" ? FIRST_NAMES_FEMALE : FIRST_NAMES_MALE;
  const firstName = firstNamePool[Math.floor(rng() * firstNamePool.length)]!;
  const lastName = LAST_NAMES[Math.floor(rng() * LAST_NAMES.length)]!;
  return { firstName, lastName };
}
