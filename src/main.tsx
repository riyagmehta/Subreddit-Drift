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

type Comment = { author: string; score: number; text: string };
type Thread = { correctAnswer: string; options: string[]; comments: Comment[]; difficulty: string };
type PlayerScore = { username: string; score: number; correct: number; date: string; streak: number };

Devvit.addCustomPostType({
  name: 'Subreddit Drift',
  height: 'tall',
  render: (context) => {
    const { useState, useInterval, redis, reddit } = context;

    const [screen, setScreen] = useState<'start' | 'loading' | 'playing' | 'results' | 'leaderboard'>('start');
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [score, setScore] = useState(0);
    const [correctCount, setCorrectCount] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [timeRemaining, setTimeRemaining] = useState(TIME_LIMIT);
    const [questionStartTime, setQuestionStartTime] = useState(Date.now());
    const [threads, setThreads] = useState<Thread[]>([]);
    const [answers, setAnswers] = useState<{ correct: boolean; time: number }[]>([]);
    const [leaderboard, setLeaderboard] = useState<PlayerScore[]>([]);
    const [alreadyPlayed, setAlreadyPlayed] = useState(false);
    const [streak, setStreak] = useState(0);
    const [loadingMessage, setLoadingMessage] = useState('Loading...');
    const [questionScores, setQuestionScores] = useState<number[]>([]);

    const timerInterval = useInterval(() => {
      if (screen !== 'playing' || selectedAnswer !== null) return;
      const elapsed = Math.floor((Date.now() - questionStartTime) / 1000);
      const remaining = Math.max(0, TIME_LIMIT - elapsed);
      setTimeRemaining(remaining);
      if (remaining === 0) handleAnswerSelect('__timeout__');
    }, 1000);
    timerInterval.start();

    const getTodayDate = () => new Date().toISOString().split('T')[0];

    const checkAlreadyPlayed = async (): Promise<boolean> => {
      try {
        const user = await reddit.getCurrentUser();
        if (!user) return false;
        const val = await redis.get(`played:${user.id}:${getTodayDate()}`);
        return val === 'true';
      } catch (e) { return false; }
    };

    const markAsPlayed = async () => {
      try {
        const user = await reddit.getCurrentUser();
        if (!user) return;
        await redis.set(`played:${user.id}:${getTodayDate()}`, 'true');
        await redis.expire(`played:${user.id}:${getTodayDate()}`, 86400 * 2);
      } catch (e) { console.error(e); }
    };

    const getStreak = async (): Promise<number> => {
      try {
        const user = await reddit.getCurrentUser();
        if (!user) return 0;
        const val = await redis.get(`streak:${user.id}`);
        return parseInt(val || '0');
      } catch (e) { return 0; }
    };

    const saveScore = async (finalScore: number, correct: number): Promise<number> => {
      try {
        const user = await reddit.getCurrentUser();
        if (!user) return 0;
        const today = getTodayDate();

        const yesterday = new Date();
        yesterday.setDate(yesterday.getDate() - 1);
        const yStr = yesterday.toISOString().split('T')[0];
        const playedY = await redis.get(`played:${user.id}:${yStr}`);
        const curStreak = parseInt(await redis.get(`streak:${user.id}`) || '0');
        const newStreak = playedY === 'true' ? curStreak + 1 : 1;

        await redis.set(`streak:${user.id}`, newStreak.toString());
        await redis.expire(`streak:${user.id}`, 86400 * 30);
        await redis.zAdd(`leaderboard:${today}`, { member: user.username, score: finalScore });
        await redis.expire(`leaderboard:${today}`, 86400 * 7);
        await redis.set(
          `score:${user.username}:${today}`,
          JSON.stringify({ username: user.username, score: finalScore, correct, date: today, streak: newStreak })
        );
        await redis.expire(`score:${user.username}:${today}`, 86400 * 7);

        return newStreak;
      } catch (e) {
        console.error('saveScore error:', e);
        return 0;
      }
    };

    const loadLeaderboard = async () => {
      try {
        const today = getTodayDate();
        const topEntries = await redis.zRange(`leaderboard:${today}`, 0, 9, { reverse: true, by: 'rank' });
        const scores: PlayerScore[] = [];
        for (const entry of topEntries) {
          const data = await redis.get(`score:${entry}:${today}`);
          if (data) scores.push(JSON.parse(data));
        }
        setLeaderboard(scores);
      } catch (e) { setLeaderboard([]); }
    };

    const getDailyChallenge = async (): Promise<Thread[]> => {
      const today = getTodayDate();
      try {
        const cached = await redis.get(`challenge:${today}`);
        if (cached) return JSON.parse(cached);
      } catch (e) { console.error('Cache check failed:', e); }
      fetchAndCacheChallenge(today).catch(e => console.error('Background fetch failed:', e));
      return FALLBACK_THREADS;
    };

    const fetchAndCacheChallenge = async (date: string) => {
      try {
        const newThreads = await generateChallenge();
        await redis.set(`challenge:${date}`, JSON.stringify(newThreads));
        await redis.expire(`challenge:${date}`, 86400);
      } catch (e) { console.error('Failed to cache challenge:', e); }
    };

    const generateChallenge = async (): Promise<Thread[]> => {
      const difficulties = ['easy', 'easy', 'medium', 'hard', 'hard'];
      const result: Thread[] = [];
      const usedSubs: string[] = [];
      for (let i = 0; i < 5; i++) {
        const thread = await fetchThreadForDifficulty(difficulties[i], usedSubs);
        result.push(thread);
        usedSubs.push(thread.correctAnswer);
      }
      return result;
    };

    const fetchThreadForDifficulty = async (difficulty: string, usedSubs: string[]): Promise<Thread> => {
      try {
        const groups = DIFFICULTY_GROUPS[difficulty as keyof typeof DIFFICULTY_GROUPS];
        const availableGroups = groups.filter(g => !g.some(s => usedSubs.includes(s)));
        const group = availableGroups.length > 0
          ? availableGroups[Math.floor(Math.random() * availableGroups.length)]
          : groups[Math.floor(Math.random() * groups.length)];

        const correctSub = group[Math.floor(Math.random() * group.length)];
        const wrongOptions = group.filter(s => s !== correctSub);

        const posts = await reddit.getTopPosts({
          subredditName: correctSub,
          timeframe: 'month',
          limit: 25,
        }).all();

        const viablePosts = posts.filter(p => p.numberOfComments >= 10);
        if (viablePosts.length === 0) throw new Error('No viable posts');

        const post = viablePosts[Math.floor(Math.random() * viablePosts.length)];
        const comments = await reddit.getComments({
          postId: post.id,
          limit: 20,
          sort: 'top',
        }).all();

        const goodComments = comments
          .filter(c =>
            c.body &&
            c.body.length > 15 &&
            c.body.length < 300 &&
            !c.body.toLowerCase().includes('[deleted]') &&
            !c.body.toLowerCase().includes('[removed]') &&
            !c.body.toLowerCase().includes('http') &&
            c.score >= 1
          )
          .slice(0, 3)
          .map(c => ({ author: c.authorName || 'anon', score: c.score, text: c.body.substring(0, 250) }));

        if (goodComments.length === 0) throw new Error('No good comments');

        return {
          correctAnswer: correctSub,
          options: [correctSub, ...wrongOptions.slice(0, 3)].sort(() => Math.random() - 0.5),
          comments: goodComments,
          difficulty
        };
      } catch (e) {
        const fallback = FALLBACK_THREADS[Math.floor(Math.random() * FALLBACK_THREADS.length)];
        return { ...fallback, difficulty };
      }
    };

    const handleStartGame = async () => {
      setLoadingMessage("Loading today's challenge...");
      setScreen('loading');
      try {
        const played = await checkAlreadyPlayed();
        if (played) {
          setAlreadyPlayed(true);
          await loadLeaderboard();
          const existingStreak = await getStreak();
          setStreak(existingStreak);
          setScreen('leaderboard');
          return;
        }
        const dailyThreads = await getDailyChallenge();
        setThreads(dailyThreads);
        setQuestionStartTime(Date.now());
        setTimeRemaining(TIME_LIMIT);
        setScreen('playing');
      } catch (e) {
        setThreads(FALLBACK_THREADS);
        setQuestionStartTime(Date.now());
        setTimeRemaining(TIME_LIMIT);
        setScreen('playing');
      }
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
        handleGameComplete();
      } else {
        setCurrentQuestion(next);
        setSelectedAnswer(null);
        setTimeRemaining(TIME_LIMIT);
        setQuestionStartTime(Date.now());
      }
    };

    const handleGameComplete = async () => {
      setLoadingMessage('Saving your score...');
      setScreen('loading');
      try {
        await markAsPlayed();
        const newStreak = await saveScore(score, correctCount);
        setStreak(newStreak);
        await loadLeaderboard();
      } catch (e) {
        console.error('Save failed:', e);
      }
      setScreen('results');
    };

    const handleShowLeaderboard = async () => {
      setLoadingMessage('Loading leaderboard...');
      setScreen('loading');
      await loadLeaderboard();
      setScreen('leaderboard');
    };

    if (screen === 'start') {
      return (
        <vstack height="100%" width="100%" alignment="center middle" gap="medium" padding="large">
          <text size="xxlarge" weight="bold" color="orangered-500">Subreddit Drift</text>
          <text size="large">Daily Reddit Culture Quiz</text>
          <spacer size="small" />
          <text alignment="center">Identify subreddits from real comment threads</text>
          <text size="small" color="neutral-content-weak">5 questions - 60 seconds each</text>
          <spacer size="medium" />
          <button onPress={handleStartGame} appearance="primary" size="large">Play Today's Challenge</button>
          <button onPress={handleShowLeaderboard} appearance="secondary" size="medium">View Leaderboard</button>
        </vstack>
      );
    }

    if (screen === 'loading') {
      return (
        <vstack height="100%" width="100%" alignment="center middle" gap="medium">
          <text size="large">{loadingMessage}</text>
          <text size="small" color="neutral-content-weak">Please wait...</text>
        </vstack>
      );
    }

    if (screen === 'results') {
      const diffMap: Record<string, string> = { easy: 'E', medium: 'M', hard: 'H' };
      const shareEmojis = answers.map(a => a.correct ? 'X' : 'O').join(' ');
      const avgTime = answers.length > 0
        ? Math.floor(answers.reduce((s, a) => s + a.time, 0) / answers.length)
        : 0;

      return (
        <vstack height="100%" width="100%" gap="small" padding="medium">
          <text size="xlarge" weight="bold" alignment="center">Game Complete!</text>
          <hstack alignment="center middle" gap="large">
            <vstack alignment="center middle">
              <text size="xxlarge" weight="bold" color="orangered-500">{score}</text>
              <text size="small" color="neutral-content-weak">Score</text>
            </vstack>
            <vstack alignment="center middle">
              <text size="xxlarge" weight="bold">{correctCount}/5</text>
              <text size="small" color="neutral-content-weak">Correct</text>
            </vstack>
            <vstack alignment="center middle">
              <text size="xxlarge" weight="bold">{avgTime}s</text>
              <text size="small" color="neutral-content-weak">Avg Time</text>
            </vstack>
            <vstack alignment="center middle">
              <text size="xxlarge" weight="bold" color="orangered-500">{streak}</text>
              <text size="small" color="neutral-content-weak">Day Streak</text>
            </vstack>
          </hstack>
          <vstack gap="small">
            {threads.map((thread, idx) => (
              <hstack
                key={`res-${idx}`}
                padding="small"
                backgroundColor="neutral-background-weak"
                cornerRadius="small"
                alignment="middle"
              >
                <text size="small" width="20px">{idx + 1}.</text>
                <text size="small" grow color={answers[idx]?.correct ? 'green-600' : 'red-600'}>
                  r/{thread.correctAnswer}
                </text>
                <text size="small" color="neutral-content-weak">
                  {answers[idx]?.correct ? `+${questionScores[idx]}` : '0 pts'}
                </text>
                <text size="small" color="neutral-content-weak"> {diffMap[thread.difficulty]}</text>
              </hstack>
            ))}
          </vstack>
          <vstack backgroundColor="neutral-background-weak" padding="small" cornerRadius="small" width="100%">
            <text size="small" alignment="center">Subreddit Drift {getTodayDate()}</text>
            <text size="medium" alignment="center" weight="bold">{shareEmojis} {correctCount}/5</text>
            <text size="small" alignment="center">
              Score: {score}{streak > 0 ? ` | ${streak} day streak` : ''}
            </text>
          </vstack>
          <button onPress={handleShowLeaderboard} appearance="primary" size="medium">View Leaderboard</button>
          <text size="small" color="neutral-content-weak" alignment="center">
            Come back tomorrow for a new challenge!
          </text>
        </vstack>
      );
    }

    if (screen === 'leaderboard') {
      return (
        <vstack height="100%" width="100%" gap="small" padding="medium">
          <text size="xlarge" weight="bold" alignment="center">Leaderboard</text>
          <text size="small" color="neutral-content-weak" alignment="center">Today's top players</text>
          {streak > 0 && (
            <hstack alignment="center middle" padding="small" backgroundColor="orangered-100" cornerRadius="small">
              <text size="small" weight="bold" color="orangered-500">
                Your streak: {streak} day{streak > 1 ? 's' : ''}
              </text>
            </hstack>
          )}
          <spacer size="small" />
          {leaderboard.length === 0 ? (
            <vstack alignment="center middle" grow>
              <text>No scores yet today!</text>
              <text size="small" color="neutral-content-weak">Be the first to play</text>
            </vstack>
          ) : (
            <vstack gap="small">
              {leaderboard.map((entry, idx) => (
                <hstack
                  key={`lb-${idx}`}
                  padding="small"
                  backgroundColor={idx === 0 ? 'orangered-100' : 'neutral-background-weak'}
                  cornerRadius="small"
                  alignment="middle"
                >
                  <text width="35px" weight="bold" size="small">
                    {idx === 0 ? '1st' : idx === 1 ? '2nd' : idx === 2 ? '3rd' : `${idx + 1}th`}
                  </text>
                  <text grow size="small">u/{entry.username}</text>
                  <text size="small" color="neutral-content-weak">{entry.correct}/5 </text>
                  <text weight="bold" color="orangered-500">{entry.score}</text>
                  {entry.streak > 1 && (
                    <text size="small" color="orangered-400"> {entry.streak}d</text>
                  )}
                </hstack>
              ))}
            </vstack>
          )}
          <spacer size="small" />
          {alreadyPlayed ? (
            <text size="small" color="neutral-content-weak" alignment="center">
              Come back tomorrow for a new challenge!
            </text>
          ) : (
            <button onPress={handleStartGame} appearance="primary" size="medium">Play Now</button>
          )}
          <button onPress={() => setScreen('start')} appearance="secondary" size="small">Back</button>
        </vstack>
      );
    }

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
      <vstack height="100%" width="100%" gap="small" padding="medium">
        <hstack alignment="space-between">
          <hstack gap="small" alignment="middle">
            <text weight="bold">Q{currentQuestion + 1}/5</text>
            <text size="small" color={difficultyColors[thread.difficulty] || 'neutral-content-weak'}>
              {thread.difficulty.toUpperCase()}
            </text>
          </hstack>
          <text weight="bold" color="orangered-500">Score: {score}</text>
        </hstack>
        <vstack gap="small">
          <hstack alignment="space-between">
            <text size="small">Time</text>
            <text size="small" weight="bold" color={timerColor}>{timeRemaining}s</text>
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
        <text size="large" weight="bold">Which subreddit?</text>
        <vstack gap="small" padding="small" backgroundColor="neutral-background-weak" cornerRadius="small">
          {thread.comments.map((comment, idx) => (
            <vstack key={`c-${idx}`}>
              <hstack gap="small">
                <text size="small" color="neutral-content-weak">u/{comment.author}</text>
                <text size="small" color="neutral-content-weak">↑{comment.score}</text>
              </hstack>
              <text size="medium">{comment.text}</text>
            </vstack>
          ))}
        </vstack>
        <vstack gap="small">
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
              size="medium"
            >
              r/{option}
            </button>
          ))}
        </vstack>
        {isAnswered && (
          <vstack alignment="center middle" gap="small">
            <text weight="bold">
              {isCorrect
                ? `Correct! +${questionScores[questionScores.length - 1]} pts`
                : `Wrong! It was r/${thread.correctAnswer}`}
            </text>
            <button onPress={handleNextQuestion} appearance="primary" size="medium">
              {currentQuestion < 4 ? 'Next Question' : 'See Results'}
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
      title: 'Daily Subreddit Drift - Test Your Reddit Knowledge!',
      subredditName: subreddit.name,
      preview: (
        <vstack height="100%" width="100%" alignment="center middle">
          <text size="xlarge" weight="bold">Subreddit Drift</text>
        </vstack>
      ),
    });
    ui.showToast('Post created!');
    ui.navigateTo(post);
  },
});

export default Devvit;