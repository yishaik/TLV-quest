from pathlib import Path

path = Path("components/QuestRealtimeProvider.tsx")
content = path.read_text()
old = '''  useEffect(() => {
    localStorage.setItem("tlvQuestParticipantToken", token);
    void refresh();

    const onVisibility = () => {
'''
new = '''  useEffect(() => {
    localStorage.setItem("tlvQuestParticipantToken", token);
    const initialRefresh = window.setTimeout(() => void refresh(), 0);

    const onVisibility = () => {
'''
if old not in content:
    raise SystemExit("initial refresh block not found")
content = content.replace(old, new, 1)
content = content.replace(
    '''    return () => {
      window.clearTimeout(stateRefreshTimer.current);
''',
    '''    return () => {
      window.clearTimeout(initialRefresh);
      window.clearTimeout(stateRefreshTimer.current);
''',
    1,
)
path.write_text(content)
