export interface Comment {
  text: string;
  author: string;
  score: number;
  timestamp: number;
}

export interface Thread {
  id: string;
  comments: Comment[];
  correctSubreddit: string;
  difficulty: DifficultyLevel;
  subredditDisplay: string;
  options: string[];
}

export type DifficultyLevel = 'easy' | 'medium' | 'hard' | 'expert';

export interface AnswerOption {
  subreddit: string;
  display: string;
  isCorrect: boolean;
}

export interface DailyChallenge {
  id: string;
  date: string;
  threads: Array<{
    correctAnswer: string;
    options: string[];
    comments: Array<{ author: string; score: number; text: string }>;
  }>;
  createdAt: number;
}

export interface PlayerAnswer {
  threadIndex: number;
  selectedSubreddit: string;
  timeTaken: number;
  isCorrect: boolean;
}

export interface PlayerScore {
  userId: string;
  username: string;
  answers: PlayerAnswer[];
  totalScore: number;
  correctCount: number;
  totalTime: number;
  date: string;
  streak: number;
  completedAt: number;
  difficulty: DifficultyLevel;
}

export interface GameState {
  currentThreadIndex: number;
  answers: PlayerAnswer[];
  startTime: number;
  threadStartTime: number;
  isComplete: boolean;
  selectedDifficulty: DifficultyLevel;
}

export interface LeaderboardEntry {
  rank: number;
  userId: string;
  username: string;
  score: number;
  correctCount: number;
  totalTime: number;
  streak: number;
  difficulty: DifficultyLevel;
}

export interface StreakData {
  userId: string;
  currentStreak: number;
  longestStreak: number;
  lastPlayedDate: string;
  totalDaysPlayed: number;
}

export const SCORING = {
  CORRECT_ANSWER: 100,
  TIME_BONUS_MULTIPLIER: 10,
  MAX_TIME_BONUS: 500,
  STREAK_BONUS: 50,
  MAX_STREAK_BONUS: 500,
  DIFFICULTY_MULTIPLIERS: {
    easy: 1,
    medium: 1.5,
    hard: 2,
    expert: 3,
  },
} as const;

export const GAME_CONFIG = {
  THREADS_PER_DAY: 5,
  OPTIONS_PER_THREAD: 4,
  TIME_LIMIT_SECONDS: 60,
  MIN_COMMENTS_PER_THREAD: 15,
  MAX_COMMENTS_DISPLAY: 20,
  LEADERBOARD_SIZE: 10,
  DIFFICULTY_LEVELS: ['easy', 'medium', 'hard', 'expert'] as const,
} as const;
