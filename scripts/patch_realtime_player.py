from pathlib import Path

premium = Path("components/PremiumQuestPlayer.tsx")
content = premium.read_text()
content = content.replace(
    '''type LeaderboardEntry = {
  team_name: string;
  score: number;
  completed_count: number;
  status: string;
  last_progress_at: string | null;
};

''',
    "",
    1,
)
premium.write_text(content)

provider = Path("components/QuestRealtimeProvider.tsx")
content = provider.read_text()
content = content.replace(
    '''    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
      throw cause;
    } finally {
''',
    '''    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unexpected error");
    } finally {
''',
    1,
)
provider.write_text(content)
