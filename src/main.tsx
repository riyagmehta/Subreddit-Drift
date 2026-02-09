import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

const SUBREDDITS = [
  'gaming', 'pcgaming', 'technology', 'programming',
  'movies', 'science', 'fitness', 'cooking'
];

// Redis Keys
const REDIS_KEYS = {
  streak: (userId: string) => `streak:${userId}`,
  score: (userId: string, date: string) => `score:${userId}:${date}`,
  leaderboard: (date: string) => `leaderboard:${date}`,
  userStats: (userId: string) => `stats:${userId}`,
  dailyChallenge: (date: string) => `challenge:${date}`,
};

const getMockComments = (subreddit: string) => {
  const comments: { [key: string]: string[] } = {
    gaming: ['Just finished this game!', 'Amazing graphics', 'Worth the money!'],
    pcgaming: ['Best performance settings?', 'Ultra settings look great', 'RTX works great'],
    technology: ['Just got the new phone', 'Love the new updates', 'Tech is advancing fast'],
    programming: ['This code is elegant', 'Clean implementation', 'Great algorithms'],
    movies: ['Best movie ever!', 'Cinematography was amazing', 'Loved the ending'],
    science: ['Fascinating research', 'Breakthrough discovery', 'Mind blowing'],
    fitness: ['New PR today!', 'Feeling great', 'Great progress!'],
    cooking: ['Delicious recipe', 'Turned out great', 'Highly recommend']
  };
  return comments[subreddit] || ['Great post!', 'Love this', 'Amazing'];
};

// Redis Backend Functions
const getStreakData = async (redis: any, userId: string) => {
  try {
    const key = REDIS_KEYS.streak(userId);
    const data = await redis.get(key);
    if (data) {
      return JSON.parse(data);
    }
    return {
      userId,
      currentStreak: 0,
      longestStreak: 0,
      lastPlayedDate: '',
      totalGamesPlayed: 0,
    };
  } catch (e) {
    console.error('Error getting streak:', e);
    return { userId, currentStreak: 0, longestStreak: 0, lastPlayedDate: '', totalGamesPlayed: 0 };
  }
};

const saveStreakData = async (redis: any, userId: string, streakData: any) => {
  try {
    const key = REDIS_KEYS.streak(userId);
    await redis.set(key, JSON.stringify(streakData), { ex: 86400 * 365 });
    return true;
  } catch (e) {
    console.error('Error saving streak:', e);
    return false;
  }
};

const saveScore = async (redis: any, userId: string, username: string, score: number, correctCount: number, date: string) => {
  try {
    // Save individual score
    const scoreKey = REDIS_KEYS.score(userId, date);
    const scoreData = {
      userId,
      username,
      score,
      correctCount,
      timestamp: Date.now(),
    };
    await redis.set(scoreKey, JSON.stringify(scoreData), { ex: 86400 * 30 });

    // Add to leaderboard (sorted set)
    const leaderboardKey = REDIS_KEYS.leaderboard(date);
    await redis.zAdd(leaderboardKey, {
      score,
      member: JSON.stringify({ userId, username, score, correctCount }),
    });

    // Trim to top 100
    await redis.zRemRangeByRank(leaderboardKey, 0, -101);

    // Update user stats
    const statsKey = REDIS_KEYS.userStats(userId);
    const statsData = await redis.get(statsKey);
    let stats = statsData ? JSON.parse(statsData) : { userId, username, totalGames: 0, totalScore: 0, highScore: 0 };
    
    stats.totalGames = (stats.totalGames || 0) + 1;
    stats.totalScore = (stats.totalScore || 0) + score;
    stats.highScore = Math.max(stats.highScore || 0, score);
    stats.lastPlayedDate = date;

    await redis.set(statsKey, JSON.stringify(stats), { ex: 86400 * 365 });

    return true;
  } catch (e) {
    console.error('Error saving score:', e);
    return false;
  }
};

const getLeaderboard = async (redis: any, date: string, limit = 10) => {
  try {
    const leaderboardKey = REDIS_KEYS.leaderboard(date);
    const entries = await redis.zRange(leaderboardKey, { start: 0, stop: limit - 1, by: 'rank', reverse: true });
    return entries.map((entry: string, idx: number) => ({
      rank: idx + 1,
      ...JSON.parse(entry),
    }));
  } catch (e) {
    console.error('Error getting leaderboard:', e);
    return [];
  }
};

const getUserStats = async (redis: any, userId: string) => {
  try {
    const statsKey = REDIS_KEYS.userStats(userId);
    const data = await redis.get(statsKey);
    if (data) {
      return JSON.parse(data);
    }
    return { userId, totalGames: 0, totalScore: 0, highScore: 0 };
  } catch (e) {
    console.error('Error getting user stats:', e);
    return { userId, totalGames: 0, totalScore: 0, highScore: 0 };
  }
};

Devvit.addCustomPostType({
  name: 'Subreddit Drift Game',
  description: 'Guess the subreddit from comments!',
  height: 'tall',
  render: (context) => {
    const { useState, useInterval } = context as any;
    
    const [gameState, setGameState] = useState('menu');
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [score, setScore] = useState(0);
    const [answers, setAnswers] = useState([]);
    const [timeLeft, setTimeLeft] = useState(60);
    const [selectedAnswer, setSelectedAnswer] = useState(null);
    const [showingResult, setShowingResult] = useState(false);
    const [userStreak, setUserStreak] = useState(0);
    const [questionOrder, setQuestionOrder] = useState([]);

    // Initialize game with random questions
    const initializeGame = async () => {
      const shuffled = [...SUBREDDITS].sort(() => Math.random() - 0.5).slice(0, 5);
      setQuestionOrder(shuffled);
      setGameState('playing');
      setCurrentQuestion(0);
      setScore(0);
      setAnswers([]);
      setTimeLeft(60);
      setSelectedAnswer(null);
      setShowingResult(false);

      const reddit = context.reddit;
      const redis = context.redis;
      try {
        const user = await reddit.getCurrentUser();
        if (user) {
          // Get current streak from Redis
          const streakData = await getStreakData(redis, user.id);
          setUserStreak(streakData.currentStreak || 0);
        }
      } catch (e) {
        console.error('Error loading user data:', e);
      }
    };

    // Timer - counts down every second during gameplay
    useInterval(() => {
      if (gameState === 'playing' && timeLeft > 0) {
        setTimeLeft(timeLeft - 1);
      }
      if (timeLeft === 1 && gameState === 'playing') {
        // Auto-submit if time runs out
        if (!showingResult && selectedAnswer === null) {
          // Time's up, show timeout feedback
          setSelectedAnswer('TIMEOUT');
          setShowingResult(true);
          setAnswers([...answers, false]);
        }
      }
    }, 1000);

    const handleNextQuestion = async () => {
      if (currentQuestion < 4) {
        setCurrentQuestion(currentQuestion + 1);
        setSelectedAnswer(null);
        setShowingResult(false);
        setTimeLeft(60);
      } else {
        // This is the last question, finish the game
        await finishGame();
      }
    };

    const handleAnswer = (selected: string) => {
      if (showingResult) return;

      const correctSub = questionOrder[currentQuestion];
      const isCorrect = selected === correctSub;

      setSelectedAnswer(selected);
      setShowingResult(true);
      setAnswers([...answers, isCorrect]);

      if (isCorrect) {
        setScore(score + 20);
      }
    };

    const finishGame = async () => {
      const reddit = context.reddit;
      const redis = context.redis;

      try {
        const user = await reddit.getCurrentUser();
        if (user) {
          const today = new Date().toISOString().split('T')[0];
          
          // Get current streak data
          const streakData = await getStreakData(redis, user.id);
          const previousDate = new Date(today);
          previousDate.setDate(previousDate.getDate() - 1);
          const previousDateStr = previousDate.toISOString().split('T')[0];

          // Calculate new streak
          let newStreak = 1;
          if (streakData.lastPlayedDate === previousDateStr) {
            newStreak = (streakData.currentStreak || 0) + 1;
          }

          // Update streak data
          const updatedStreakData = {
            userId: user.id,
            currentStreak: newStreak,
            longestStreak: Math.max(newStreak, streakData.longestStreak || 0),
            lastPlayedDate: today,
            totalGamesPlayed: (streakData.totalGamesPlayed || 0) + 1,
          };

          // Save to Redis
          await saveStreakData(redis, user.id, updatedStreakData);
          await saveScore(redis, user.id, user.username, score, answers.filter((a: any) => a).length, today);

          setUserStreak(newStreak);
        }
      } catch (e) {
        console.error('Error finishing game:', e);
      }

      setGameState('result');
    };

    const resetGame = () => {
      setGameState('menu');
      setSelectedAnswer(null);
      setShowingResult(false);
    };

    // MENU SCREEN
    if (gameState === 'menu') {
      return (
        <vstack height="100%" width="100%" alignment="center middle" gap="large" padding="large" backgroundColor="neutral-background-strong">
          <text size="xxlarge" weight="bold" color="orangered-500">🎮 Subreddit Drift</text>
          <text size="large" alignment="center">Guess the subreddit from the comments!</text>
          
          {userStreak > 0 && (
            <vstack padding="medium" backgroundColor="neutral-background-weak" cornerRadius="medium" alignment="center" width="100%">
              <text size="large" weight="bold" color="orangered-500">🔥 {userStreak} Day Streak!</text>
            </vstack>
          )}

          <spacer />
          <button onPress={initializeGame} size="large">
            Start Game
          </button>
        </vstack>
      );
    }

    // RESULT SCREEN
    if (gameState === 'result') {
      const correctCount = answers.filter(a => a).length;
      const emoji = answers.map(a => a ? '🟩' : '🟥').join('');

      return (
        <vstack height="100%" width="100%" alignment="center middle" gap="medium" padding="large" backgroundColor="neutral-background-strong">
          <text size="xxlarge" weight="bold">🎉 Game Over!</text>
          <text size="xlarge" weight="bold" color="orangered-500">Score: {score}</text>
          <text size="large">{correctCount}/5 Correct</text>
          <text size="large">🔥 Streak: {userStreak}</text>
          <text size="medium" color="neutral-content">{emoji}</text>

          {correctCount === 5 && <text size="large" color="green-500">Perfect Score! 🌟</text>}
          {correctCount >= 3 && correctCount < 5 && <text size="large">Great job! 💪</text>}
          {correctCount < 3 && <text size="large">Better luck tomorrow! 📚</text>}

          <text size="small" color="neutral-content-weak">Score saved to leaderboard ✓</text>

          <spacer />
          <button onPress={resetGame} size="large">
            Back to Menu
          </button>
        </vstack>
      );
    }

    // PLAYING SCREEN
    if (gameState === 'playing' && questionOrder.length > 0) {
      const correctSub = questionOrder[currentQuestion];
      const comments = getMockComments(correctSub);

      // Create 4 options with correct answer and 3 random wrong ones
      const options = [correctSub];
      while (options.length < 4) {
        const random = SUBREDDITS[Math.floor(Math.random() * SUBREDDITS.length)];
        if (!options.includes(random)) {
          options.push(random);
        }
      }
      options.sort(() => Math.random() - 0.5);

      return (
        <vstack height="100%" width="100%" padding="small" gap="small" backgroundColor="neutral-background-strong">
          {/* Header - compact */}
          <hstack width="100%" alignment="center">
            <text size="medium" weight="bold">Q{currentQuestion + 1}/5</text>
            <spacer />
            <text size="medium" weight="bold" color="orangered-500">Score: {score}</text>
            <spacer />
            <text size="medium" weight="bold" color={timeLeft < 10 ? 'red-500' : 'neutral-content'}>⏱ {timeLeft}s</text>
          </hstack>

          {/* Progress bar */}
          <hstack width="100%" height="4px" backgroundColor="neutral-background-weak" cornerRadius="small">
            <vstack width={`${(currentQuestion / 5) * 100}%`} height="100%" backgroundColor="orangered-500" cornerRadius="small" />
          </hstack>

          {/* Comments section - compact */}
          <vstack gap="small" padding="small" backgroundColor="neutral-background-weak" cornerRadius="medium">
            <text weight="bold" size="small" color="orangered-500">r/{correctSub}:</text>
            {comments.slice(0, 2).map((comment) => (
              <text size="small" color="neutral-content">• {comment}</text>
            ))}
          </vstack>

          {/* Question */}
          <text size="medium" weight="bold" alignment="center">Which subreddit?</text>

          {/* Options - buttons that show feedback */}
          <vstack gap="small" width="100%">
            {options.map((option) => {
              const isCorrect = option === correctSub;
              const isSelected = selectedAnswer === option;
              
              let bgColor = 'neutral-background-weak';
              let textColor = 'neutral-content';

              if (showingResult) {
                if (isCorrect) {
                  bgColor = 'green-500';
                  textColor = 'white';
                } else if (isSelected) {
                  bgColor = 'red-500';
                  textColor = 'white';
                }
              }

              return (
                <button 
                  key={option}
                  onPress={() => handleAnswer(option)}
                  disabled={showingResult}
                  appearance="secondary"
                >
                  r/{option} {isCorrect && showingResult ? ' ✓' : ''} {isSelected && !isCorrect && showingResult ? ' ✗' : ''}
                </button>
              );
            })}
          </vstack>

          {/* FEEDBACK SECTION - Show immediately after answer */}
          {showingResult ? (
            <vstack gap="medium" padding="small" backgroundColor="neutral-background-weak" cornerRadius="medium" alignment="center" width="100%">
              {selectedAnswer === 'TIMEOUT' ? (
                <vstack gap="small" alignment="center">
                  <text weight="bold" size="large" color="red-500">⏰ Time's Up!</text>
                  <text size="small" color="neutral-content">Right: r/{correctSub}</text>
                </vstack>
              ) : selectedAnswer === correctSub ? (
                <text weight="bold" size="large" color="green-500">✅ Correct!</text>
              ) : (
                <vstack gap="small" alignment="center">
                  <text weight="bold" size="large" color="red-500">❌ Wrong!</text>
                  <text size="small" color="neutral-content">Right: r/{correctSub}</text>
                </vstack>
              )}
              <button onPress={handleNextQuestion} appearance="primary">
                {currentQuestion === 4 ? 'See Results' : 'Next →'}
              </button>
            </vstack>
          ) : (
            <vstack gap="small" padding="small" backgroundColor="neutral-background-weak" cornerRadius="medium" alignment="center" width="100%">
              <text size="small" color="neutral-content-weak">↑ Select answer</text>
            </vstack>
          )}
        </vstack>
      );
    }

    // Loading
    return (
      <vstack height="100%" width="100%" alignment="center middle" backgroundColor="neutral-background-strong">
        <text size="large" weight="bold">Loading...</text>
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
      title: '🎮 Subreddit Drift - Daily Quiz!',
      subredditName: subreddit.name,
      preview: (
        <vstack height="100%" width="100%" alignment="center middle" gap="medium" padding="large" backgroundColor="neutral-background">
          <text size="xxlarge" weight="bold" color="orangered-500">🎮 Subreddit Drift</text>
          <text size="large">Guess the subreddit!</text>
        </vstack>
      ),
    });
    ui.showToast('🎮 Post created!');
    ui.navigateTo(post);
  },
});

export default Devvit;
