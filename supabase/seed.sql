INSERT INTO public.data_sources (code, label, description)
VALUES
  ('D3_ADMIN', 'D3 Admin', 'D3 Amateur platform administration source'),
  ('CLUB', 'Club', 'Club-provided operational data'),
  ('PLAYER', 'Player', 'Player-provided profile data'),
  ('RNA', 'RNA', 'French register of associations data'),
  ('DATA_ES', 'Data ES', 'Data ES import source')
ON CONFLICT (code) DO NOTHING;
