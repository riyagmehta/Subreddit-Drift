import { Devvit } from '@devvit/public-api';

Devvit.configure({
  redditAPI: true,
  redis: true,
});

const SUBREDDIT_POOL = [
  'gaming', 'pcgaming', 'technology', 'programming',
  'movies', 'television', 'science', 'askscience',
  'fitness', 'cooking', 'Art', 'DIY', 'Music', 'books'
];

const TIME_LIMIT = 60; // seconds

Devvit.addCustomPostType({
  name: 'Subreddit Drift',
  height: 'tall',
  render: (context) => {
    const { useState, useInterval } = context;
    
    const [gameStarted, setGameStarted] = useState(false);
    const [currentQuestion, setCurrentQuestion] = useState(0);
    const [score, setScore] = useState(0);
    const [selectedAnswer, setSelectedAnswer] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [timeRemaining, setTimeRemaining] = useState(TIME_LIMIT);
    const [questionStartTime, setQuestionStartTime] = useState(Date.now());
    const [currentThread, setCurrentThread] = useState<{
      correctAnswer: string;
      options: string[];
      comments: Array<{ author: string; score: number; text: string }>;
    } | null>(null);
    
    // Timer countdown
    const timerInterval = useInterval(() => {
      if (!gameStarted || isLoading || selectedAnswer !== null || currentQuestion >= 5) {
        return;
      }
      
      const elapsed = Math.floor((Date.now() - questionStartTime) / 1000);
      const remaining = Math.max(0, TIME_LIMIT - elapsed);
      setTimeRemaining(remaining);
      
      // Auto-submit when time runs out
      if (remaining === 0 && selectedAnswer === null && currentThread) {
        handleAnswerSelect(currentThread.options[0], true); // Wrong answer
      }
    }, 1000);
    
    timerInterval.start();
    
    const fetchRandomThread = async () => {
      setIsLoading(true);
      const reddit = context.reddit;
      
      try {
        const randomSub = SUBREDDIT_POOL[Math.floor(Math.random() * SUBREDDIT_POOL.length)];
        
        const posts = await reddit.getTopPosts({
          subredditName: randomSub,
          timeframe: 'month',
          limit: 50,
        }).all();
        
        if (posts.length === 0) {
          throw new Error('No posts found');
        }
        
        const viablePosts = posts.filter(p => p.numberOfComments >= 10);
        
        if (viablePosts.length === 0) {
          throw new Error('No posts with enough comments');
        }
        
        let goodComments: Array<{ author: string; score: number; text: string }> = [];
        let attempts = 0;
        
        while (goodComments.length < 2 && attempts < 3) {
          const selectedPost = viablePosts[Math.floor(Math.random() * viablePosts.length)];
          
          const comments = await reddit.getComments({
            postId: selectedPost.id,
            limit: 30,
            sort: 'top',
          }).all();
          
          const filtered = comments
            .filter(c => 
              c.body && 
              c.body.length > 15 && 
              c.body.length < 400 &&
              !c.body.toLowerCase().includes('[deleted]') &&
              !c.body.toLowerCase().includes('[removed]') &&
              !c.body.toLowerCase().includes('http') &&
              c.score >= 1
            )
            .map(c => ({
              author: c.authorName || 'anonymous',
              score: c.score,
              text: c.body.substring(0, 250)
            }));
          
          goodComments = filtered.slice(0, 3);
          attempts++;
        }
        
        if (goodComments.length === 0) {
          throw new Error('Could not find suitable comments');
        }
        
        const wrongOptions = SUBREDDIT_POOL
          .filter(sub => sub !== randomSub)
          .sort(() => Math.random() - 0.5)
          .slice(0, 3);
        
        const options = [randomSub, ...wrongOptions].sort(() => Math.random() - 0.5);
        
        setCurrentThread({
          correctAnswer: randomSub,
          options: options,
          comments: goodComments
        });
        
      } catch (error) {
        console.error('Error fetching thread:', error);
        
        const mockQuestions = [
          {
            correctAnswer: 'gaming',
            options: ['gaming', 'pcgaming', 'technology', 'movies'],
            comments: [
              { author: 'gamer123', score: 250, text: 'Just finished this game and wow, the ending was incredible!' },
              { author: 'player456', score: 180, text: 'Anyone else think the graphics are a huge step up from the previous version?' },
              { author: 'casual_fan', score: 95, text: 'Been playing for hours, totally worth the purchase!' },
            ]
          },
          {
            correctAnswer: 'technology',
            options: ['technology', 'programming', 'science', 'pcgaming'],
            comments: [
              { author: 'tech_enthusiast', score: 340, text: 'The new processor architecture is a game changer for mobile devices.' },
              { author: 'early_adopter', score: 220, text: 'Finally upgraded and the performance difference is night and day.' },
              { author: 'skeptical_user', score: 150, text: 'Battery life could be better but overall solid improvements.' },
            ]
          },
          {
            correctAnswer: 'movies',
            options: ['movies', 'television', 'Music', 'Art'],
            comments: [
              { author: 'film_buff', score: 420, text: 'The cinematography in this film is absolutely breathtaking.' },
              { author: 'critic_wannabe', score: 280, text: 'Best plot twist I have seen in years. Totally unexpected!' },
              { author: 'weekend_viewer', score: 165, text: 'Went in with low expectations but came out amazed.' },
            ]
          },
        ];
        
        const fallback = mockQuestions[currentQuestion % mockQuestions.length];
        setCurrentThread(fallback);
      }
      
      setIsLoading(false);
      setQuestionStartTime(Date.now());
      setTimeRemaining(TIME_LIMIT);
    };
    
    const handleStartGame = async () => {
      setGameStarted(true);
      await fetchRandomThread();
    };
    
    const handleAnswerSelect = (answer: string, timeOut: boolean = false) => {
      if (selectedAnswer !== null) return;
      
      const timeTaken = Math.floor((Date.now() - questionStartTime) / 1000);
      setSelectedAnswer(answer);
      
      if (currentThread && answer === currentThread.correctAnswer && !timeOut) {
        // Base score + time bonus
        const baseScore = 100;
        const timeBonus = Math.max(0, (TIME_LIMIT - timeTaken) * 2); // 2 points per second saved
        const totalPoints = baseScore + timeBonus;
        setScore(score + totalPoints);
      }
    };
    
    const handleNextQuestion = async () => {
      setCurrentQuestion(currentQuestion + 1);
      setSelectedAnswer(null);
      await fetchRandomThread();
    };
    
    const handlePlayAgain = () => {
      setGameStarted(false);
      setCurrentQuestion(0);
      setScore(0);
      setSelectedAnswer(null);
      setCurrentThread(null);
      setTimeRemaining(TIME_LIMIT);
    };
    
    if (!gameStarted) {
      return (
        <vstack height="100%" width="100%" alignment="center middle" gap="medium" padding="large">
          <text size="xxlarge" weight="bold" color="orangered-500">Subreddit Drift</text>
          <text size="large">Daily Reddit Culture Quiz</text>
          <spacer size="small" />
          <text alignment="center">Identify subreddits from real comment threads</text>
          <text size="small" color="neutral-content-weak">5 questions - 60 seconds each</text>
          <spacer size="medium" />
          <button onPress={handleStartGame} appearance="primary" size="large">Start Game</button>
        </vstack>
      );
    }
    
    if (isLoading || !currentThread) {
      return (
        <vstack height="100%" width="100%" alignment="center middle" gap="medium">
          <text size="large">Loading thread from Reddit...</text>
          <text size="small" color="neutral-content-weak">Question {currentQuestion + 1}/5</text>
        </vstack>
      );
    }
    
    if (currentQuestion >= 5) {
      return (
        <vstack height="100%" width="100%" alignment="center middle" gap="medium" padding="large">
          <text size="xxlarge" weight="bold">Game Complete!</text>
          <text size="xlarge" color="orangered-500">Score: {score}</text>
          <text size="medium">You got {Math.floor(score / 100)} out of 5 correct!</text>
          <spacer size="small" />
          <text size="small" color="neutral-content-weak">
            Includes time bonuses: +{score % 500} points
          </text>
          <spacer size="medium" />
          <button onPress={handlePlayAgain} appearance="primary" size="large">Play Again</button>
        </vstack>
      );
    }
    
    const isAnswered = selectedAnswer !== null;
    const isCorrect = selectedAnswer === currentThread.correctAnswer;
    const timerPercent = (timeRemaining / TIME_LIMIT) * 100;
    const timerColor = timeRemaining > 20 ? 'green-500' : timeRemaining > 10 ? 'yellow-500' : 'red-500';
    
    return (
      <vstack height="100%" width="100%" gap="small" padding="medium">
        <hstack alignment="center" gap="medium">
          <text weight="bold">Q{currentQuestion + 1}/5</text>
          <spacer size="medium" />
          <text weight="bold" color="orangered-500">Score: {score}</text>
        </hstack>
        
        {/* Timer Bar */}
        <vstack gap="small">
          <hstack alignment="center" gap="medium">
            <text size="small" weight="bold">Time Remaining</text>
            <spacer size="medium" />
            <text size="small" weight="bold" color={timerColor}>{timeRemaining}s</text>
          </hstack>
          <hstack width="100%" height="8px" backgroundColor="neutral-background-weak" cornerRadius="full">
            <hstack 
              width={`${timerPercent}%`} 
              height="8px" 
              backgroundColor={timerColor}
              cornerRadius="full"
            />
          </hstack>
        </vstack>
        
        <text size="large" weight="bold">Which subreddit?</text>
        
        <vstack gap="small" padding="small" backgroundColor="neutral-background-weak" cornerRadius="small">
          {currentThread.comments.map((comment, idx) => (
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
          {currentThread.options.map((option, idx) => (
            <button
              key={`opt-${idx}`}
              onPress={() => handleAnswerSelect(option)}
              appearance={
                isAnswered
                  ? option === currentThread.correctAnswer ? 'success'
                  : option === selectedAnswer ? 'destructive' : 'secondary'
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
              {isCorrect ? 'Correct!' : `Wrong! r/${currentThread.correctAnswer}`}
            </text>
            {isCorrect && (
              <text size="small" color="neutral-content-weak">
                +{100 + Math.max(0, (TIME_LIMIT - Math.floor((Date.now() - questionStartTime) / 1000)) * 2)} points
              </text>
            )}
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
