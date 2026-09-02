import { NextResponse } from "next/server";
import { searchOpponentClubs } from "@/lib/matches/data";

export async function GET(request: Request) {
  const query = new URL(request.url).searchParams.get("q") ?? "";
  try {
    return NextResponse.json({ clubs: await searchOpponentClubs(query) });
  } catch {
    return NextResponse.json({ error: "Recherche adversaire indisponible" }, { status: 503 });
  }
}
