import {NextResponse} from 'next/server';import {searchPlayers} from '@/lib/players/data';
export async function GET(request:Request){const query=new URL(request.url).searchParams.get('q')??'';try{return NextResponse.json({players:await searchPlayers(query)})}catch{return NextResponse.json({error:'Recherche joueurs indisponible'},{status:503})}}
