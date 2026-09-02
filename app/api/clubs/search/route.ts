import {NextResponse} from 'next/server';import {searchClubs} from '@/lib/clubs/data';
export async function GET(request:Request){const query=new URL(request.url).searchParams.get('q')??'';try{return NextResponse.json({clubs:await searchClubs(query)})}catch{return NextResponse.json({error:'Recherche momentanément indisponible'},{status:503})}}
