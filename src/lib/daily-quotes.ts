export interface DailyQuote {
  text: string;
  author: string;
  source: string;
}

// Short quotations with recorded sources. Keeping provenance beside the copy
// prevents the common motivational-quote problem of silently misattributing it.
export const DAILY_QUOTES: readonly DailyQuote[] = [
  {
    text: "The important thing is not to stop questioning.",
    author: "Albert Einstein",
    source: "LIFE interview, May 2, 1955",
  },
  {
    text: "The only way to do great work is to love what you do.",
    author: "Steve Jobs",
    source: "Stanford commencement address, 2005",
  },
  {
    text: "Knowledge itself is power.",
    author: "Francis Bacon",
    source: "Meditationes Sacrae, 1597",
  },
  {
    text: "If I have seen further, it is by standing on the shoulders of giants.",
    author: "Isaac Newton",
    source: "Letter to Robert Hooke, 1675",
  },
  {
    text: "The unexamined life is not worth living.",
    author: "Socrates",
    source: "Plato, Apology 38a",
  },
  {
    text: "While we teach, we learn.",
    author: "Seneca",
    source: "Moral Letters to Lucilius, Letter 7",
  },
  {
    text: "Chance favors only the prepared mind.",
    author: "Louis Pasteur",
    source: "University of Lille lecture, 1854",
  },
  {
    text: "The time is always right to do what is right.",
    author: "Martin Luther King Jr.",
    source: "Oberlin College commencement address, 1965",
  },
  {
    text: "Education is the most powerful weapon which you can use to change the world.",
    author: "Nelson Mandela",
    source: "Madison Park High School address, 1990",
  },
  {
    text: "It always seems impossible until it’s done.",
    author: "Nelson Mandela",
    source: "Mandela: The Authorised Book of Quotations, 2011",
  },
] as const;

export function getDailyQuote(date = new Date()): DailyQuote {
  const dayNumber = Math.floor(
    Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / (24 * 60 * 60 * 1000),
  );
  return DAILY_QUOTES[
    ((dayNumber % DAILY_QUOTES.length) + DAILY_QUOTES.length) % DAILY_QUOTES.length
  ];
}
