import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

type PersonRecord = {
  id: string;
  first_name: string;
  last_name: string;
  gender?: string | null;
};

type RelationRecord = {
  from_person: string;
  to_person: string;
  relationship: string;
};

type TreeNode = {
  name: string;
  spousePairs?: { husband: string; wife: string }[];
  children?: TreeNode[];
};

function parseFullName(name: string) {
  const trimmed = name.trim();
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) return null;
  return {
    first: parts.slice(0, -1).join(" "),
    last: parts[parts.length - 1],
  };
}

function formatName(person: PersonRecord | undefined) {
  if (!person) return "Unknown";
  return `${person.first_name} ${person.last_name}`;
}

function formatCouplePair(person: PersonRecord, spouse: PersonRecord) {
  const personGender = person.gender || "";
  const spouseGender = spouse.gender || "";
  const hasMale = personGender === "male" || spouseGender === "male";
  const hasFemale = personGender === "female" || spouseGender === "female";

  if (hasMale && hasFemale) {
    const husband = personGender === "male" ? person : spouse;
    const wife = personGender === "female" ? person : spouse;
    return {
      husband: `${husband.first_name} ${husband.last_name}`,
      wife: `${wife.first_name} ${wife.last_name}`,
    };
  }

  return {
    husband: `${person.first_name} ${person.last_name}`,
    wife: `${spouse.first_name} ${spouse.last_name}`,
  };
}
export async function GET(request: Request) {
  const url = new URL(request.url);
  const rootName = url.searchParams.get("root") || "";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "Missing Supabase server credentials. Please check your environment variables." },
      { status: 500 }
    );
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false },
  });

  const parsedRoot = parseFullName(rootName);
  const rootPersonQuery = parsedRoot
    ? supabase
        .from("person")
        .select("id, first_name, last_name, gender")
        .eq("first_name", parsedRoot.first)
        .eq("last_name", parsedRoot.last)
        .maybeSingle()
    : supabase
        .from("person")
        .select("id, first_name, last_name, gender")
        .limit(1)
        .maybeSingle();

  const { data: rootPerson, error: rootError } = await rootPersonQuery;
  if (rootError) {
    return NextResponse.json(
      { error: `Failed to fetch root person: ${rootError.message}` },
      { status: 500 }
    );
  }

  const { data: persons, error: personsError } = await supabase
    .from("person")
    .select("id, first_name, last_name, gender");

  if (personsError) {
    return NextResponse.json(
      { error: `Failed to fetch persons: ${personsError.message}` },
      { status: 500 }
    );
  }

  const { data: relations, error: relationsError } = await supabase
    .from("relation")
    .select("from_person, to_person, relationship");

  if (relationsError) {
    return NextResponse.json(
      { error: `Failed to fetch relations: ${relationsError.message}` },
      { status: 500 }
    );
  }

  const peopleById = new Map<string, PersonRecord>();
  (persons || []).forEach((person) => peopleById.set(person.id, person));

  const childrenById = new Map<string, string[]>();
  const spousesById = new Map<string, string[]>();

  (relations || []).forEach((rel: RelationRecord) => {
    if (rel.relationship === "child") {
      const existing = childrenById.get(rel.from_person) || [];
      existing.push(rel.to_person);
      childrenById.set(rel.from_person, existing);
      return;
    }
    if (rel.relationship === "spouse") {
      const existing = spousesById.get(rel.from_person) || [];
      existing.push(rel.to_person);
      spousesById.set(rel.from_person, existing);
    }
  });

  const visited = new Set<string>();

  function buildTree(personId: string | undefined): TreeNode | null {
    if (!personId) return null;
    if (visited.has(personId)) {
      return {
        name: `${formatName(peopleById.get(personId))} (cycle)`,
      };
    }
    visited.add(personId);

    const person = peopleById.get(personId);
    if (!person) return null;

    const spouseIds = spousesById.get(personId) || [];
    const childIds = childrenById.get(personId) || [];

    const spousePairs = spouseIds
      .map((id) => {
        const spouse = peopleById.get(id);
        if (!spouse) return null;
        return formatCouplePair(person, spouse);
      })
      .filter((pair): pair is { husband: string; wife: string } => Boolean(pair));
    const children = childIds
      .map((id) => buildTree(id))
      .filter((child): child is TreeNode => Boolean(child));

    return {
      name: formatName(person),
      spousePairs: spousePairs.length > 0 ? spousePairs : undefined,
      children: children.length > 0 ? children : undefined,
    };
  }

  const tree = buildTree(rootPerson?.id);
  return NextResponse.json({ tree });
}
