import nextEnv from '@next/env';import {createClient} from '@supabase/supabase-js';import crypto from 'node:crypto';nextEnv.loadEnvConfig(process.cwd());
const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,serviceKey=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!url||!key||!serviceKey)throw new Error('Supabase env missing');const service=createClient(url,serviceKey,{auth:{persistSession:false}}),anon=createClient(url,key,{auth:{persistSession:false}});let n=0;const ok=(value,label)=>{if(!value)throw new Error(`FAIL ${label}: got ${JSON.stringify(value)}`);console.log(`ok ${++n} - ${label}`)};
const suffix=crypto.randomUUID(),password=`D3!${suffix}`;
let ownerId,ownerBId,clubA,clubB,teamSeasonA,teamSeasonB,seasonId,playerA,playerB,playerC,match1,match2,match3;
const clubIds=[],playerIds=[],matchIds=[];
async function makeUser(label){const email=`step5c-${label}-${suffix}@example.invalid`;const created=await service.auth.admin.createUser({email,password,email_confirm:true});if(created.error)throw created.error;const authClient=createClient(url,key,{auth:{persistSession:false}});const login=await authClient.auth.signInWithPassword({email,password});if(login.error)throw login.error;return {id:created.data.user.id,client:createClient(url,key,{global:{headers:{Authorization:`Bearer ${login.data.session.access_token}`}},auth:{persistSession:false}})}}
async function addPlayer(teamSeasonId,first,last,actorId=ownerId){const r=await service.rpc('manage_roster_player',{actor_id:actorId,target_team_season_id:teamSeasonId,existing_player_id:null,new_first_name:first,new_last_name:last,new_slug:`${first}-${last}-${crypto.randomUUID()}`.toLowerCase(),position_value:'MIDFIELDER',squad_value:null});if(r.error)throw r.error;playerIds.push(r.data);return r.data}
async function makeMatch(homeTs,awayTs,extOpponent,kickoffOffsetDays){const kickoff=new Date(Date.now()+kickoffOffsetDays*24*3600*1000).toISOString();const r=await service.rpc('create_match',{actor_id:ownerId,p_home_team_season_id:homeTs,p_away_team_season_id:awayTs,p_external_opponent_name:extOpponent,p_competition_season_id:null,p_competition_group_id:null,p_venue_id:null,p_kickoff_at:kickoff,p_venue_name:null});if(r.error)throw r.error;matchIds.push(r.data);return r.data}
try{
  const owner=await makeUser('owner'),ownerB=await makeUser('ownerb');ownerId=owner.id;ownerBId=ownerB.id;
  const clubs=await service.from('clubs').insert([{slug:`step5c-a-${suffix}`,official_name:'Step 5C Test Club A',display_name:'Step 5C Test Club A',status:'active',claim_status:'claimed'},{slug:`step5c-b-${suffix}`,official_name:'Step 5C Test Club B',display_name:'Step 5C Test Club B',status:'active',claim_status:'claimed'}]).select('id');if(clubs.error)throw clubs.error;[clubA,clubB]=clubs.data.map(c=>c.id);clubIds.push(clubA,clubB);
  await service.from('club_memberships').insert([{club_id:clubA,user_id:ownerId,role:'OWNER',active:true},{club_id:clubB,user_id:ownerBId,role:'OWNER',active:true}]).throwOnError();
  let r=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:1});if(r.error)throw r.error;teamSeasonA=r.data.id;seasonId=r.data.season_id;
  r=await service.rpc('ensure_senior_team',{actor_id:ownerBId,target_club_id:clubB,rank_value:1});if(r.error)throw r.error;teamSeasonB=r.data.id;

  playerA=await addPlayer(teamSeasonA,'Dupont','TestA');
  playerB=await addPlayer(teamSeasonA,'Martin','TestA');
  playerC=await addPlayer(teamSeasonA,'Bench','TestA');

  // Match 1: Dupont STARTER + GOAL + GOAL(assist Martin) + yellow. Martin STARTER. Bench(C) BENCH, no sub.
  match1=await makeMatch(teamSeasonA,teamSeasonB,null,-10);
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_match_id:match1,p_home_score:2,p_away_score:0});if(r.error)throw r.error;
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:match1,p_team_season_id:teamSeasonA,p_entries:[{player_id:playerA,lineup_role:'STARTER'},{player_id:playerB,lineup_role:'STARTER'},{player_id:playerC,lineup_role:'BENCH'}]});if(r.error)throw r.error;
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:match1,p_team_season_id:teamSeasonA,p_event_type:'GOAL',p_primary_player_id:playerA,p_secondary_player_id:null,p_minute:10,p_added_time:null,p_goal_kind:'NORMAL',p_card_kind:null});if(r.error)throw r.error;
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:match1,p_team_season_id:teamSeasonA,p_event_type:'GOAL',p_primary_player_id:playerA,p_secondary_player_id:playerB,p_minute:40,p_added_time:null,p_goal_kind:'NORMAL',p_card_kind:null});if(r.error)throw r.error;const goal2Id=r.data;
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:match1,p_team_season_id:teamSeasonA,p_event_type:'YELLOW_CARD',p_primary_player_id:playerA,p_secondary_player_id:null,p_minute:60,p_added_time:null,p_goal_kind:null,p_card_kind:null});if(r.error)throw r.error;

  let stats=await service.from('player_team_season_stats').select('*').eq('player_id',playerA).eq('team_season_id',teamSeasonA).single();
  ok(stats.data.appearances===1&&stats.data.starts===1&&stats.data.substitute_appearances===0,'after match1: Dupont appearances=1, starts=1, subs=0');
  ok(stats.data.documented_goals===2&&stats.data.documented_assists===0&&stats.data.yellow_cards===1,'after match1: Dupont goals=2, assists=0, yellow=1');
  let statsB=await service.from('player_team_season_stats').select('*').eq('player_id',playerB).eq('team_season_id',teamSeasonA).single();
  ok(statsB.data.documented_assists===1&&statsB.data.appearances===1,'after match1: Martin assists=1, appearances=1');
  let statsC=await service.from('player_team_season_stats').select('appearances').eq('player_id',playerC).eq('team_season_id',teamSeasonA).maybeSingle();
  ok(!statsC.data||statsC.data.appearances===0,'BENCH without a substitution event does NOT count as an appearance (Bench player: 0 or no row)');

  // --- Match 2: Bench(C) enters as substitute for Martin ---
  match2=await makeMatch(teamSeasonA,teamSeasonB,null,-5);
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:match2,p_team_season_id:teamSeasonA,p_entries:[{player_id:playerA,lineup_role:'STARTER'},{player_id:playerB,lineup_role:'STARTER'},{player_id:playerC,lineup_role:'BENCH'}]});if(r.error)throw r.error;

  // Regression check: a lineup saved on a still-SCHEDULED match (result not
  // entered yet) must not already count as a documented appearance -- only
  // a PLAYED match produces real facts.
  statsC=await service.from('player_team_season_stats').select('appearances').eq('player_id',playerC).eq('team_season_id',teamSeasonA).maybeSingle();
  ok(!statsC.data||statsC.data.appearances===0,'a lineup saved on a SCHEDULED (not yet PLAYED) match contributes zero appearances');

  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_home_score:1,p_away_score:0,p_match_id:match2});if(r.error)throw r.error;
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:match2,p_team_season_id:teamSeasonA,p_event_type:'SUBSTITUTION',p_primary_player_id:playerB,p_secondary_player_id:playerC,p_minute:70,p_added_time:null,p_goal_kind:null,p_card_kind:null});if(r.error)throw r.error;const subEventId=r.data;

  statsC=await service.from('player_team_season_stats').select('appearances,substitute_appearances,starts').eq('player_id',playerC).eq('team_season_id',teamSeasonA).single();
  ok(statsC.data.appearances===1&&statsC.data.substitute_appearances===1&&statsC.data.starts===0,'after match2: Bench player who entered as sub -> appearances=1, substitute_appearances=1');

  r=await service.rpc('delete_match_event',{actor_id:ownerId,p_event_id:subEventId});if(r.error)throw r.error;
  statsC=await service.from('player_team_season_stats').select('appearances').eq('player_id',playerC).eq('team_season_id',teamSeasonA).maybeSingle();
  ok(!statsC.data||statsC.data.appearances===0,'removing the substitution event -> Bench player appearance disappears immediately (no stale counter)');
  // re-create it for the rest of the flow
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:match2,p_team_season_id:teamSeasonA,p_event_type:'SUBSTITUTION',p_primary_player_id:playerB,p_secondary_player_id:playerC,p_minute:70,p_added_time:null,p_goal_kind:null,p_card_kind:null});if(r.error)throw r.error;

  // --- Own goal test: Player A own goal, score independence ---
  const scoreBefore=await service.from('matches').select('home_score,away_score').eq('id',match1).single();
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:match1,p_team_season_id:teamSeasonA,p_event_type:'OWN_GOAL',p_primary_player_id:playerA,p_secondary_player_id:null,p_minute:80,p_added_time:null,p_goal_kind:null,p_card_kind:null});if(r.error)throw r.error;const ownGoalId=r.data;
  stats=await service.from('player_team_season_stats').select('documented_goals,documented_own_goals').eq('player_id',playerA).eq('team_season_id',teamSeasonA).single();
  ok(stats.data.documented_own_goals===1&&stats.data.documented_goals===2,'OWN_GOAL increments documented_own_goals, never documented_goals (still 2)');
  const scoreAfter=await service.from('matches').select('home_score,away_score').eq('id',match1).single();
  ok(scoreAfter.data.home_score===scoreBefore.data.home_score&&scoreAfter.data.away_score===scoreBefore.data.away_score,'score independence: OWN_GOAL never touched matches.home_score/away_score');

  // --- Event correction: reassign a GOAL from A to B ---
  stats=await service.from('player_team_season_stats').select('documented_goals').eq('player_id',playerA).eq('team_season_id',teamSeasonA).single();
  const aGoalsBefore=stats.data.documented_goals;
  r=await service.rpc('update_match_event',{actor_id:ownerId,p_event_id:goal2Id,p_primary_player_id:playerB,p_secondary_player_id:null,p_minute:40,p_added_time:null,p_goal_kind:'NORMAL',p_card_kind:null});if(r.error)throw r.error;
  stats=await service.from('player_team_season_stats').select('documented_goals').eq('player_id',playerA).eq('team_season_id',teamSeasonA).single();
  ok(stats.data.documented_goals===aGoalsBefore-1,'reassigning a GOAL to another player immediately decrements the original scorer\'s documented_goals');
  statsB=await service.from('player_team_season_stats').select('documented_goals,documented_assists').eq('player_id',playerB).eq('team_season_id',teamSeasonA).single();
  ok(statsB.data.documented_goals===1,'...and immediately increments the new scorer\'s documented_goals (no async job, no manual recalculation)');
  ok(statsB.data.documented_assists===0,'the assist secondary_player_id was cleared by the reassignment (no longer credited)');
  // put it back for downstream expectations
  r=await service.rpc('update_match_event',{actor_id:ownerId,p_event_id:goal2Id,p_primary_player_id:playerA,p_secondary_player_id:playerB,p_minute:40,p_added_time:null,p_goal_kind:'NORMAL',p_card_kind:null});if(r.error)throw r.error;

  // --- Lineup removal test: Player C's only documented appearance so far is
  // the substitution in match2. Removing them entirely from match2's sheet
  // (a corrected lineup) must make that appearance vanish immediately, even
  // though the orphaned SUBSTITUTION event row still references them --
  // is_substitute_appearance is only ever true for a row that still exists
  // in match_appearances, so a removed player yields no such row to be true.
  r=await service.rpc('delete_match_event',{actor_id:ownerId,p_event_id:ownGoalId});if(r.error)throw r.error; // clean up own goal before touching match1's sheet later
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:match2,p_team_season_id:teamSeasonA,p_entries:[{player_id:playerA,lineup_role:'STARTER'},{player_id:playerB,lineup_role:'STARTER'}]});if(r.error)throw r.error;
  statsC=await service.from('player_team_season_stats').select('appearances').eq('player_id',playerC).eq('team_season_id',teamSeasonA).maybeSingle();
  ok(!statsC.data||statsC.data.appearances===0,'removing Player C from match2 sheet drops their only documented appearance to 0 immediately');

  // --- Distinct match appearance / no double counting defensiveness ---
  // Player A is now a documented STARTER in two real matches (match1, match2)
  // for teamSeasonA: appearances must be exactly 2, never more.
  let tsAStats=await service.from('player_team_season_stats').select('appearances,starts').eq('player_id',playerA).eq('team_season_id',teamSeasonA).single();
  ok(tsAStats.data.appearances===2&&tsAStats.data.starts===2,'Dupont: 2 documented starts across match1+match2 -> appearances=2');

  // Starter + erroneous substitution event non-duplication: add a bogus
  // SUBSTITUTION for match1 that (incorrectly) brings A on, even though A
  // already started that same match. A single real appearance per match
  // must never become two just because a second, contradictory event also
  // references the player.
  r=await service.rpc('create_match_event',{actor_id:ownerId,p_match_id:match1,p_team_season_id:teamSeasonA,p_event_type:'SUBSTITUTION',p_primary_player_id:playerB,p_secondary_player_id:playerA,p_minute:85,p_added_time:null,p_goal_kind:null,p_card_kind:null});if(r.error)throw r.error;const bogusSubId=r.data;
  tsAStats=await service.from('player_team_season_stats').select('appearances').eq('player_id',playerA).eq('team_season_id',teamSeasonA).single();
  ok(tsAStats.data.appearances===2,'a contradictory SUBSTITUTION event bringing a STARTER on does not create a second appearance for the same match (still 2, not 3)');
  r=await service.rpc('delete_match_event',{actor_id:ownerId,p_event_id:bogusSubId});if(r.error)throw r.error;

  const seasonStatsA=await service.from('player_season_stats').select('appearances').eq('player_id',playerA).eq('season_id',seasonId).single();
  ok(seasonStatsA.data.appearances===2,'season-level appearances for Dupont = 2 (match1+match2, distinct match_id, no double count)');

  // --- Multi-team same club: Player A added to a second team (Seniors B) ---
  r=await service.rpc('ensure_senior_team',{actor_id:ownerId,target_club_id:clubA,rank_value:2});if(r.error)throw r.error;const teamSeasonA2=r.data.id;
  const rB=await service.rpc('manage_roster_player',{actor_id:ownerId,target_team_season_id:teamSeasonA2,existing_player_id:playerA,new_first_name:null,new_last_name:null,new_slug:null,position_value:'MIDFIELDER',squad_value:null});if(rB.error)throw rB.error;
  match3=await makeMatch(teamSeasonA2,teamSeasonB,null,-2);
  r=await service.rpc('save_match_lineup',{actor_id:ownerId,p_match_id:match3,p_team_season_id:teamSeasonA2,p_entries:[{player_id:playerA,lineup_role:'STARTER'}]});if(r.error)throw r.error;
  r=await service.rpc('enter_match_result',{actor_id:ownerId,p_home_score:3,p_away_score:1,p_match_id:match3});if(r.error)throw r.error;
  tsAStats=await service.from('player_team_season_stats').select('appearances').eq('player_id',playerA).eq('team_season_id',teamSeasonA).single();
  const tsA2Stats=await service.from('player_team_season_stats').select('appearances').eq('player_id',playerA).eq('team_season_id',teamSeasonA2).single();
  ok(tsAStats.data.appearances===2&&tsA2Stats.data.appearances===1,'multi-team: Seniors A=2 appearances, Seniors B=1 appearance (separate rows, never merged)');
  const seasonStatsA2=await service.from('player_season_stats').select('appearances').eq('player_id',playerA).eq('season_id',seasonId).single();
  ok(seasonStatsA2.data.appearances===3,'season total for Dupont = 3 (2+1 across both teams, correctly summed, not deduped across different matches)');
  const careerStatsA=await service.from('player_career_stats').select('appearances,documented_clubs').eq('player_id',playerA).single();
  ok(careerStatsA.data.appearances===3&&careerStatsA.data.documented_clubs===1,'career stats: 3 appearances, 1 documented club (both teams are the same club)');

  // --- Coverage view: Seniors A played 2 documented matches (match1, match2),
  // both with a non-empty lineup and at least one event, neither with a
  // full 11-player starting XI (a realistic amateur-fixture gap that must
  // show up honestly, never be papered over as "complete").
  const coverage=await service.from('team_season_data_coverage').select('*').eq('team_season_id',teamSeasonA).single();
  ok(coverage.data.played_matches===2,'team_season_data_coverage: Seniors A has 2 PLAYED matches');
  ok(coverage.data.matches_with_any_lineup_data===2,'both PLAYED matches have at least some documented lineup');
  ok(coverage.data.matches_with_any_event_data===2,'both PLAYED matches have at least one documented event');
  ok(coverage.data.matches_with_complete_starting_lineup===0,'neither match has a full 11-player starting lineup documented -- never rounded up to "complete"');
  ok(coverage.data.matches_with_any_lineup_data<=coverage.data.played_matches,'matches_with_any_lineup_data never exceeds played_matches');

  // --- RLS: anon can read all these views, cannot write ---
  let ranon=await anon.from('player_team_season_stats').select('appearances').eq('player_id',playerA).eq('team_season_id',teamSeasonA).single();
  ok(ranon.data?.appearances===2,'anon can publicly read player_team_season_stats');
  ranon=await anon.from('player_season_stats').select('appearances').eq('player_id',playerA).eq('season_id',seasonId).single();
  ok(ranon.data?.appearances===3,'anon can publicly read player_season_stats');
  ranon=await anon.from('player_career_stats').select('appearances').eq('player_id',playerA).single();
  ok(ranon.data?.appearances===3,'anon can publicly read player_career_stats');
  ranon=await anon.from('team_season_data_coverage').select('played_matches').eq('team_season_id',teamSeasonA).single();
  ok(typeof ranon.data?.played_matches==='number','anon can publicly read team_season_data_coverage');
  ranon=await anon.from('player_team_season_stats').insert({player_id:playerA,team_season_id:teamSeasonA,appearances:999});
  ok(Boolean(ranon.error),'anon cannot write to player_team_season_stats (it is a view over RLS-protected tables, no INSERT grant/policy exists)');

  console.log(`PASS ${n} Step 5C derived stats assertions`);
}finally{
  if(matchIds.length){await service.from('match_events').delete().in('match_id',matchIds);await service.from('match_appearances').delete().in('match_id',matchIds);await service.from('admin_audit_logs').delete().in('entity_id',matchIds);await service.from('matches').delete().in('id',matchIds)}
  if(playerIds.length){await service.from('player_registrations').delete().in('player_id',playerIds);await service.from('team_roster_members').delete().in('player_id',playerIds);await service.from('product_events').delete().in('entity_id',playerIds);await service.from('admin_audit_logs').delete().in('entity_id',playerIds);await service.from('players').delete().in('id',playerIds)}
  const teams=clubIds.length?await service.from('teams').select('id').in('club_id',clubIds):{data:[]};const teamIds=(teams.data??[]).map(t=>t.id);
  if(teamIds.length){const teamSeasons=await service.from('team_seasons').select('id').in('team_id',teamIds);const teamSeasonIds=(teamSeasons.data??[]).map(t=>t.id);if(teamSeasonIds.length)await service.from('team_seasons').delete().in('id',teamSeasonIds);await service.from('admin_audit_logs').delete().in('entity_id',teamIds);await service.from('teams').delete().in('id',teamIds)}
  if(clubIds.length){await service.from('club_memberships').delete().in('club_id',clubIds);await service.from('admin_audit_logs').delete().in('entity_id',clubIds);await service.from('clubs').delete().in('id',clubIds)}
  for(const id of [ownerId,ownerBId].filter(Boolean))await service.auth.admin.deleteUser(id);
}
