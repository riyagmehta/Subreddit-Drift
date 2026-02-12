import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

const SUBREDDIT_POOL = [
  'gaming', 'pcgaming', 'technology', 'programming',
  'movies', 'television', 'anime', 'Music', 'books',
  'science', 'askscience', 'space', 'biology',
  'fitness', 'cooking', 'DIY', 'gardening',
  'Art', 'photography', 'writing',
  'AskReddit', 'explainlikeimfive', 'todayilearned', 'Showerthoughts',
  'sports', 'soccer', 'nba',
];

const DIFFICULTY_GROUPS = {
  easy: [
    ['gaming', 'cooking', 'space', 'Art'],
    ['movies', 'fitness', 'programming', 'gardening'],
    ['Music', 'science', 'DIY', 'anime'],
  ],
  medium: [
    ['gaming', 'pcgaming', 'technology', 'anime'],
    ['movies', 'television', 'anime', 'books'],
    ['science', 'askscience', 'biology', 'space'],
  ],
  hard: [
    ['programming', 'technology', 'pcgaming', 'science'],
    ['fitness', 'sports', 'soccer', 'nba'],
    ['AskReddit', 'explainlikeimfive', 'Showerthoughts', 'todayilearned'],
  ],
};

const TIME_LIMIT = 60;

const FALLBACK_THREADS = [
  {
    correctAnswer: 'gaming',
    options: ['gaming', 'pcgaming', 'technology', 'movies'],
    comments: [
      { author: 'gamer_pro', score: 450, text: 'Finally beat the final boss after 3 hours. The ending was worth it!' },
      { author: 'casual_player', score: 230, text: 'Anyone know a fix for the stuttering in the latest patch?' },
      { author: 'retro_fan', score: 180, text: 'This reminds me so much of the classics from the 90s.' },
    ],
    difficulty: 'easy'
  },
  {
    correctAnswer: 'technology',
    options: ['technology', 'programming', 'science', 'pcgaming'],
    comments: [
      { author: 'tech_daily', score: 520, text: 'The new chip architecture is a massive leap forward for the industry.' },
      { author: 'early_bird', score: 310, text: 'Ordered mine day one. The speed difference is unreal.' },
      { author: 'skeptic99', score: 200, text: 'Impressive specs but the price point is hard to justify.' },
    ],
    difficulty: 'easy'
  },
  {
    correctAnswer: 'movies',
    options: ['movies', 'television', 'books', 'Music'],
    comments: [
      { author: 'cinephile', score: 680, text: 'The director nailed the third act. Standing ovation worthy.' },
      { author: 'popcorn_fan', score: 410, text: 'Went in blind and was completely blown away. Best of the year.' },
      { author: 'film_student', score: 290, text: 'The practical effects alone make this worth watching on the big screen.' },
    ],
    difficulty: 'medium'
  },
  {
    correctAnswer: 'programming',
    options: ['programming', 'technology', 'science', 'pcgaming'],
    comments: [
      { author: 'dev_life', score: 890, text: 'Spent 6 hours debugging. Turned out to be a missing comma. I need a break.' },
      { author: 'clean_coder', score: 540, text: 'This design pattern completely changed how I think about state management.' },
      { author: 'bootcamp_grad', score: 320, text: 'Can someone explain why this async function is not returning what I expect?' },
    ],
    difficulty: 'hard'
  },
  {
    correctAnswer: 'fitness',
    options: ['fitness', 'sports', 'cooking', 'science'],
    comments: [
      { author: 'gym_rat', score: 430, text: 'Hit a new deadlift PR today. All those early mornings finally paid off.' },
      { author: 'marathon_mom', score: 280, text: 'Week 8 of training done. My knees hate me but my heart loves me.' },
      { author: 'newbie_lifter', score: 190, text: 'Should I do cardio before or after lifting? Getting mixed info online.' },
    ],
    difficulty: 'hard'
  },
];

// Helper to get today's date string
function getTodayKey(): string {
  const today = new Date();
  return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
}

Devvit.addCustomPostType({
  name: 'Subreddit Drift',
  height: 'tall',
  render: (context) => {
    const { useState, useInterval, redis, postId } = context;

    const [screen, setScreen] = useState<'start' | 'loading' | 'playing' | 'results' | 'leaderboard'>('start');
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [score, setScore] = useState(0);
    const [correctCount, setCorrectCount] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [timeRemaining, setTimeRemaining] = useState(TIME_LIMIT);
    const [questionStartTime, setQuestionStartTime] = useState(Date.now());
    const [threads] = useState(FALLBACK_THREADS);
    const [answers, setAnswers] = useState<{ correct: boolean; time: number }[]>([]);
    const [streak, setStreak] = useState(1);
    const [questionScores, setQuestionScores] = useState<number[]>([]);
    const [leaderboardData, setLeaderboardData] = useState<Array<{username: string; score: number; correct: number; streak: number}>>([]);
    const [playedToday, setPlayedToday] = useState(false);
    const [username, setUsername] = useState<string>('');

    // Load data when screen changes
    const loadLeaderboard = async () => {
      try {
        const entries = await redis.zRange(`leaderboard:${postId}`, 0, 9, { reverse: true, by: 'score' });
        const data = await Promise.all(
          entries.map(async (entry) => {
            const playerData = await redis.hGetAll(`player:${postId}:${entry.member}`);
            return {
              username: entry.member,
              score: entry.score,
              correct: parseInt(playerData.correct || '0'),
              streak: parseInt(playerData.streak || '1'),
            };
          })
        );
        setLeaderboardData(data);
      } catch (e) {
        console.error('Error loading leaderboard:', e);
      }
    };

    const checkIfPlayedToday = async () => {
      try {
        const currentUser = await context.reddit.getCurrentUser();
        if (!currentUser) return;
        
        setUsername(currentUser.username);
        const todayKey = getTodayKey();
        const lastPlayed = await redis.get(`lastPlayed:${postId}:${currentUser.username}`);
        const userStreak = await redis.get(`streak:${postId}:${currentUser.username}`);
        
        setPlayedToday(lastPlayed === todayKey);
        if (userStreak) {
          setStreak(parseInt(userStreak));
        }
      } catch (e) {
        console.error('Error checking play status:', e);
      }
    };

    const timerInterval = useInterval(() => {
      if (screen !== 'playing' || selectedAnswer !== null) return;
      const elapsed = Math.floor((Date.now() - questionStartTime) / 1000);
      const remaining = Math.max(0, TIME_LIMIT - elapsed);
      setTimeRemaining(remaining);
      if (remaining === 0) handleAnswerSelect('__timeout__');
    }, 1000);
    timerInterval.start();

    const handleStartGame = async () => {
      if (playedToday) {
        context.ui.showToast("You've already played today! Come back tomorrow for a new challenge.");
        return;
      }
      
      setScreen('playing');
      setQuestionStartTime(Date.now());
      setTimeRemaining(TIME_LIMIT);
    };

    const handleAnswerSelect = (answer: string) => {
      if (selectedAnswer !== null) return;
      setSelectedAnswer(answer);
      const timeTaken = Math.floor((Date.now() - questionStartTime) / 1000);
      const thread = threads[currentQuestion];
      const isCorrect = answer === thread?.correctAnswer && answer !== '__timeout__';
      const timeBonus = isCorrect ? Math.max(0, (TIME_LIMIT - timeTaken) * 2) : 0;
      const questionScore = isCorrect ? 100 + timeBonus : 0;
      if (isCorrect) {
        setScore(prev => prev + questionScore);
        setCorrectCount(prev => prev + 1);
      }
      setAnswers(prev => [...prev, { correct: isCorrect, time: timeTaken }]);
      setQuestionScores(prev => [...prev, questionScore]);
    };

    const handleNextQuestion = () => {
      const next = currentQuestion + 1;
      if (next >= 5) {
        saveScore();
        setScreen('results');
      } else {
        setCurrentQuestion(next);
        setSelectedAnswer(null);
        setTimeRemaining(TIME_LIMIT);
        setQuestionStartTime(Date.now());
      }
    };

    const saveScore = async () => {
      if (!username) return;

      const todayKey = getTodayKey();
      const avgTime = answers.length > 0
        ? Math.floor(answers.reduce((s, a) => s + a.time, 0) / answers.length)
        : 0;

      // Update streak
      const lastPlayed = await redis.get(`lastPlayed:${postId}:${username}`);
      let newStreak = 1;
      if (lastPlayed) {
        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yesterdayKey = `${yesterday.getFullYear()}-${String(yesterday.getMonth() + 1).padStart(2, '0')}-${String(yesterday.getDate()).padStart(2, '0')}`;
        if (lastPlayed === yesterdayKey) {
          const currentStreak = await redis.get(`streak:${postId}:${username}`);
          newStreak = parseInt(currentStreak || '1') + 1;
        }
      }

      // Save to Redis
      await redis.zAdd(`leaderboard:${postId}`, { member: username, score });
      await redis.hSet(`player:${postId}:${username}`, {
        correct: correctCount.toString(),
        streak: newStreak.toString(),
        avgTime: avgTime.toString(),
      });
      await redis.set(`lastPlayed:${postId}:${username}`, todayKey);
      await redis.set(`streak:${postId}:${username}`, newStreak.toString());
      
      setStreak(newStreak);
      setPlayedToday(true);
    };

    const handleViewLeaderboard = async () => {
      setScreen('leaderboard');
      await loadLeaderboard();
    };

    // START SCREEN
    if (screen === 'start') {
      // Load user data when on start screen
      if (!username) {
        checkIfPlayedToday();
      }
      
      return (
        <vstack height="100%" width="100%" alignment="center middle" gap="medium" padding="large">
          <text size="xxlarge" weight="bold" color="orangered-500">🎯 Subreddit Drift</text>
          <text size="large" weight="bold">Daily Reddit Culture Quiz</text>
          <spacer size="small" />
          <text alignment="center" color="neutral-content">Identify subreddits from real comment threads</text>
          <text size="small" color="neutral-content-weak">5 questions • 60 seconds each</text>
          
          {playedToday && (
            <vstack padding="medium" backgroundColor="yellow-100" cornerRadius="medium" gap="small">
              <text size="medium" weight="bold" alignment="center">✅ Completed Today!</text>
              <text size="small" alignment="center">Come back tomorrow for a new challenge</text>
            </vstack>
          )}
          
          {streak > 1 && (
            <hstack gap="small" alignment="center middle">
              <text size="large">🔥</text>
              <text size="medium" weight="bold" color="orangered-500">{streak} Day Streak!</text>
            </hstack>
          )}
          
          <spacer size="medium" />
          <vstack gap="small" width="100%">
            <button 
              onPress={handleStartGame} 
              appearance="primary" 
              size="large"
              disabled={playedToday}
            >
              {playedToday ? 'Already Played Today' : '🎮 Play Today\'s Challenge'}
            </button>
            <button onPress={handleViewLeaderboard} appearance="secondary" size="medium">
              🏆 View Leaderboard
            </button>
          </vstack>
          
          <spacer size="small" />
          <vstack gap="small" alignment="center">
            <text size="small" color="neutral-content-weak">Scoring:</text>
            <text size="small" color="neutral-content-weak">• 100 points + time bonus per correct answer</text>
            <text size="small" color="neutral-content-weak">• Faster answers = higher scores!</text>
          </vstack>
        </vstack>
      );
    }

    // LEADERBOARD SCREEN
    if (screen === 'leaderboard') {
      return (
        <vstack height="100%" width="100%" gap="medium" padding="medium">
          <hstack alignment="space-between">
            <text size="xlarge" weight="bold">🏆 Leaderboard</text>
            <button onPress={() => setScreen('start')} appearance="secondary" size="small">
              Back
            </button>
          </hstack>
          
          {leaderboardData && leaderboardData.length > 0 ? (
            <vstack gap="small">
              {leaderboardData.map((entry, idx) => (
                <hstack
                  key={`lb-${idx}`}
                  padding="medium"
                  backgroundColor={idx < 3 ? 'yellow-100' : 'neutral-background-weak'}
                  cornerRadius="medium"
                  alignment="middle"
                  gap="medium"
                >
                  <text size="large" weight="bold" width="30px">
                    {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : `${idx + 1}.`}
                  </text>
                  <vstack grow gap="none">
                    <text weight="bold">u/{entry.username}</text>
                    <hstack gap="medium">
                      <text size="small" color="neutral-content-weak">
                        {entry.correct}/5 correct
                      </text>
                      {entry.streak > 1 && (
                        <text size="small" color="orangered-500">
                          🔥 {entry.streak} streak
                        </text>
                      )}
                    </hstack>
                  </vstack>
                  <vstack alignment="end">
                    <text size="large" weight="bold" color="orangered-500">
                      {entry.score}
                    </text>
                    <text size="small" color="neutral-content-weak">points</text>
                  </vstack>
                </hstack>
              ))}
            </vstack>
          ) : (
            <vstack alignment="center middle" grow gap="small">
              <text size="large">🎮</text>
              <text>No scores yet!</text>
              <text size="small" color="neutral-content-weak">Be the first to play</text>
            </vstack>
          )}
        </vstack>
      );
    }

    // RESULTS SCREEN
    if (screen === 'results') {
      const diffMap: Record<string, string> = { easy: 'E', medium: 'M', hard: 'H' };
      const shareEmojis = answers.map(a => a.correct ? '✅' : '❌').join(' ');
      const avgTime = answers.length > 0
        ? Math.floor(answers.reduce((s, a) => s + a.time, 0) / answers.length)
        : 0;

      return (
        <vstack height="100%" width="100%" gap="small" padding="small">
          <text size="large" weight="bold" alignment="center">🎉 Complete!</text>
          
          <hstack alignment="center middle" gap="medium">
            <vstack alignment="center middle">
              <text size="xlarge" weight="bold" color="orangered-500">{score}</text>
              <text size="small" color="neutral-content-weak">Score</text>
            </vstack>
            <vstack alignment="center middle">
              <text size="xlarge" weight="bold">{correctCount}/5</text>
              <text size="small" color="neutral-content-weak">Correct</text>
            </vstack>
            <vstack alignment="center middle">
              <text size="large" weight="bold">🔥{streak}</text>
              <text size="small" color="neutral-content-weak">Streak</text>
            </vstack>
          </hstack>
          
          <vstack gap="none">
            {threads.map((thread, idx) => (
              <hstack
                key={`res-${idx}`}
                padding="small"
                backgroundColor="neutral-background-weak"
                cornerRadius="small"
                alignment="middle"
                gap="small"
              >
                <text size="small">{answers[idx]?.correct ? '✅' : '❌'}</text>
                <text size="small" grow color={answers[idx]?.correct ? 'green-600' : 'red-600'}>
                  r/{thread.correctAnswer}
                </text>
                <text size="small" color="neutral-content-weak">
                  {answers[idx]?.correct ? `+${questionScores[idx]}` : '0'}
                </text>
              </hstack>
            ))}
          </vstack>
          
          <vstack backgroundColor="neutral-background-weak" padding="small" cornerRadius="small" gap="none">
            <text size="small" alignment="center">Subreddit Drift 🎯</text>
            <text size="medium" alignment="center" weight="bold">{shareEmojis}</text>
            <text size="small" alignment="center">{correctCount}/5 • {score} pts</text>
          </vstack>
          
          <hstack gap="small">
            <button onPress={handleViewLeaderboard} appearance="secondary" size="small" grow>
              🏆 Board
            </button>
            <button onPress={() => setScreen('start')} appearance="primary" size="small" grow>
              Home
            </button>
          </hstack>
        </vstack>
      );
    }

    // PLAYING SCREEN
    const thread = threads[currentQuestion];
    if (!thread) {
      return (
        <vstack height="100%" width="100%" alignment="center middle">
          <text>Loading question...</text>
        </vstack>
      );
    }

    const isAnswered = selectedAnswer !== null;
    const isCorrect = selectedAnswer === thread.correctAnswer;
    const timerPercent = (timeRemaining / TIME_LIMIT) * 100;
    const timerColor = timeRemaining > 20 ? 'green-500' : timeRemaining > 10 ? 'yellow-500' : 'red-500';
    const difficultyColors: Record<string, string> = {
      easy: 'green-600', medium: 'yellow-600', hard: 'red-600'
    };

    return (
      <vstack height="100%" width="100%" gap="none" padding="small">
        <hstack alignment="space-between" padding="small">
          <hstack gap="small" alignment="middle">
            <text weight="bold" size="small">Q{currentQuestion + 1}/5</text>
            <text size="small" color={difficultyColors[thread.difficulty] || 'neutral-content-weak'}>
              {thread.difficulty.toUpperCase()}
            </text>
          </hstack>
          <text weight="bold" color="orangered-500" size="small">💯 {score}</text>
        </hstack>
        
        <vstack gap="none" padding="small">
          <hstack alignment="space-between">
            <text size="small">⏱️ {timeRemaining}s</text>
            <text size="small" weight="bold">Which subreddit?</text>
          </hstack>
          <hstack width="100%" height="6px" backgroundColor="neutral-background-weak" cornerRadius="full">
            <hstack
              width={`${timerPercent}%`}
              height="6px"
              backgroundColor={timerColor}
              cornerRadius="full"
            />
          </hstack>
        </vstack>
        
        <vstack gap="none" padding="small" backgroundColor="neutral-background-weak" cornerRadius="small">
          {thread.comments.map((comment, idx) => (
            <vstack key={`c-${idx}`} gap="none" padding="small">
              <hstack gap="small">
                <text size="small" color="neutral-content-weak">u/{comment.author}</text>
                <text size="small" color="orangered-500">↑{comment.score}</text>
              </hstack>
              <text size="small">{comment.text}</text>
            </vstack>
          ))}
        </vstack>
        
        <vstack gap="none" padding="small">
          {thread.options.map((option, idx) => (
            <button
              key={`opt-${idx}`}
              onPress={() => handleAnswerSelect(option)}
              appearance={
                isAnswered
                  ? option === thread.correctAnswer ? 'success'
                  : option === selectedAnswer ? 'destructive'
                  : 'secondary'
                  : 'secondary'
              }
              disabled={isAnswered}
              size="small"
            >
              r/{option}
            </button>
          ))}
        </vstack>
        
        {isAnswered && (
          <vstack alignment="center middle" gap="none" padding="small">
            <text weight="bold" size="small">
              {isCorrect
                ? `🎉 +${questionScores[questionScores.length - 1]} pts`
                : `❌ r/${thread.correctAnswer}`}
            </text>
            <button onPress={handleNextQuestion} appearance="primary" size="small">
              {currentQuestion < 4 ? 'Next →' : 'Results'}
            </button>
          </vstack>
        )}
      </vstack>
    );
  },
});

Devvit.addMenuItem({
  label: 'Create Subreddit Drift Post',
  location: 'subreddit',
  onPress: async (_event, context) => {
    const { reddit, ui } = context;
    const subreddit = await reddit.getCurrentSubreddit();
    const post = await reddit.submitPost({
      title: '🎯 Daily Subreddit Drift - Test Your Reddit Knowledge!',
      subredditName: subreddit.name,
      preview: (
        <vstack height="100%" width="100%" alignment="center middle" gap="medium" padding="large">
          <text size="xxlarge" weight="bold" color="orangered-500">🎯 Subreddit Drift</text>
          <text size="large">Daily Reddit Culture Quiz</text>
          <text size="small" color="neutral-content-weak">Tap to play!</text>
        </vstack>
      ),
    });
    ui.showToast('🎮 Post created successfully!');
    ui.navigateTo(post);
  },
});

export default Devvit;
