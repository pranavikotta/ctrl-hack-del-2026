// src/App.jsx
import { useState, useRef, useEffect } from 'react'
import './App.css'

function App() {
  // Navigation state
  const [currentPage, setCurrentPage] = useState('goal-selection'); // 'goal-selection', 'chat', 'metrics', 'dashboard', 'journal'
  
  // State to store chat history
  const [messages, setMessages] = useState([]);
  
  // State for the current user input
  const [inputValue, setInputValue] = useState("");
  
  // State to track if we are waiting for the backend
  const [isLoading, setIsLoading] = useState(false);
  
  // State to store the final profile once onboarding is done
  const [userProfile, setUserProfile] = useState(null);

  // State for goal selection
  const [selectedGoal, setSelectedGoal] = useState("");

  // State for metrics
  const [metrics, setMetrics] = useState({
    age: 25,
    height_cm: 170,
    weight_kg: 70,
    resting_bpm: 70
  });

  // State to store partial profile data from chat
  const [partialProfile, setPartialProfile] = useState(null);

  // Journal state
  const [journalEntry, setJournalEntry] = useState('');
  const [journalResult, setJournalResult] = useState(null);
  const [journalHistory, setJournalHistory] = useState([
    { day: 'Mon', sentiment: 0.45, date: 'Feb 10' },
    { day: 'Tue', sentiment: 0.60, date: 'Feb 11' },
    { day: 'Wed', sentiment: 0.75, date: 'Feb 12' },
    { day: 'Thu', sentiment: 0.70, date: 'Feb 13' },
    { day: 'Fri', sentiment: 0.85, date: 'Feb 14' },
    { day: 'Sat', sentiment: 0.90, date: 'Feb 15' },
    { day: 'Sun', sentiment: 0.50, date: 'Feb 16' }
  ]);

  // Workout stats state
  const [workoutStats, setWorkoutStats] = useState({
    completed: 3,
    goal: 4,
    percentage: 75,
    remaining: 1
  });

  // State for typing animation
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  // Auto-scroll to bottom of chat
  const chatEndRef = useRef(null);
  
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages, displayedText]);

  // Fetch dashboard data when user profile is loaded
  useEffect(() => {
    if (userProfile && currentPage === 'dashboard') {
      fetchDashboardData();
    }
  }, [userProfile, currentPage]);

  const fetchDashboardData = async () => {
    if (!userProfile) return;

    try {
      // Fetch journal history
      const historyResponse = await fetch(`http://127.0.0.1:8000/journal_history/${userProfile.user_id}`);
      const historyData = await historyResponse.json();
      if (historyData.history && historyData.history.length > 0) {
        setJournalHistory(historyData.history);
      }

      // Fetch workout stats  
      const statsResponse = await fetch(`http://127.0.0.1:8000/workout_stats/${userProfile.user_id}`);
      const statsData = await statsResponse.json();
      // Store in state for workout progress card
      if (statsData.completed !== undefined) {
        setWorkoutStats(statsData);
      }
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    }
  };

  // Typing animation effect
  useEffect(() => {
    if (currentMessageIndex < messages.length) {
      const lastMessage = messages[currentMessageIndex];
      
      if (lastMessage.role === 'model') {
        setIsTyping(true);
        setDisplayedText("");
        
        let index = 0;
        const text = lastMessage.content;
        
        const interval = setInterval(() => {
          if (index < text.length) {
            setDisplayedText(text.substring(0, index + 1));
            index++;
          } else {
            clearInterval(interval);
            setIsTyping(false);
            setCurrentMessageIndex(currentMessageIndex + 1);
          }
        }, 20);
        
        return () => clearInterval(interval);
      } else {
        setCurrentMessageIndex(currentMessageIndex + 1);
      }
    }
  }, [messages, currentMessageIndex]);

  const handleGoalSelection = async (goal) => {
    setSelectedGoal(goal);
    setCurrentPage('chat');
    
    // Initialize conversation with selected goal
    const initialMessage = { role: 'user', content: `My goal is ${goal}` };
    const newHistory = [initialMessage];
    setMessages(newHistory);
    setIsLoading(true);

    try {
      const response = await fetch('http://127.0.0.1:8000/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newHistory),
      });

      const data = await response.json();

      if (data.status === "chatting") {
        setMessages(prev => [...prev, { role: 'model', content: data.message }]);
      }
    } catch (error) {
      console.error("Connection error:", error);
      setMessages(prev => [...prev, { role: 'model', content: "Error connecting to server. Is main.py running?" }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSendMessage = async () => {
    if (!inputValue.trim() || isTyping) return;

    const newHistory = [...messages, { role: 'user', content: inputValue }];
    setMessages(newHistory);
    setInputValue("");
    setIsLoading(true);

    try {
      const response = await fetch('http://127.0.0.1:8000/onboard', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newHistory),
      });

      const data = await response.json();

      if (data.status === "chatting") {
        setMessages(prev => [...prev, { role: 'model', content: data.message }]);
      } else if (data.status === "needs_metrics") {
        // Store partial profile and move to metrics page
        setPartialProfile(data.partial_data);
        setCurrentPage('metrics');
      } else if (data.status === "complete") {
        setUserProfile(data.data);
        setCurrentPage('dashboard');
      }
    } catch (error) {
      console.error("Connection error:", error);
      setMessages(prev => [...prev, { role: 'model', content: "Error connecting to server." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMetricsSubmit = async () => {
    if (!partialProfile) {
      alert('Error: Missing profile data');
      return;
    }

    const completeProfile = {
      ...partialProfile,
      age: parseInt(metrics.age),
      height_cm: parseFloat(metrics.height_cm),
      weight_kg: parseFloat(metrics.weight_kg),
      resting_bpm: parseInt(metrics.resting_bpm)
    };

    setIsLoading(true);

    try {
      const response = await fetch('http://127.0.0.1:8000/complete_profile', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(completeProfile),
      });

      const data = await response.json();

      if (data.status === "complete") {
        setUserProfile(data.data);
        setCurrentPage('dashboard');
      } else if (data.status === "error") {
        alert('Error: ' + data.message);
      }
    } catch (error) {
      console.error("Connection error:", error);
      alert('Failed to complete profile');
    } finally {
      setIsLoading(false);
    }
  };

  const handleJournalSubmit = async () => {
    if (!journalEntry.trim()) return;

    setIsLoading(true);

    try {
      const response = await fetch(`http://127.0.0.1:8000/journal?user_id=${userProfile.user_id}&entry_text=${encodeURIComponent(journalEntry)}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const data = await response.json();
      setJournalResult(data);
      
      // Add to journal history
      const today = new Date();
      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const newEntry = {
        day: dayNames[today.getDay()],
        sentiment: data.score,
        date: today.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      };
      
      // Update history (keep last 7 days)
      setJournalHistory(prev => {
        const updated = [...prev.slice(1), newEntry];
        return updated;
      });
      
    } catch (error) {
      console.error("Journal error:", error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // --- RENDER: Goal Selection Screen ---
  if (currentPage === 'goal-selection') {
    return (
      <div className="container">
        <div className="goal-selection">
          <h1 className="welcome-title">What's your fitness goal?</h1>
          <p className="welcome-subtitle">Choose one to get started</p>
          <div className="goal-buttons">
            <button className="goal-button" onClick={() => handleGoalSelection("Building Muscle")}>
              Building Muscle
            </button>
            <button className="goal-button" onClick={() => handleGoalSelection("Weight Loss")}>
              Weight Loss
            </button>
            <button className="goal-button" onClick={() => handleGoalSelection("Staying Active")}>
              Staying Active
            </button>
            <button className="goal-button" onClick={() => handleGoalSelection("Training for Sports")}>
              Training for Sports
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- RENDER: Chat Screen ---
  if (currentPage === 'chat') {
    return (
      <div className="container">
        <div className="scroll-container">
          <div className="messages-area">
            {messages.map((msg, index) => {
              if (index >= currentMessageIndex) return null;
              
              const isPrevious = index < currentMessageIndex - 1 || (index === currentMessageIndex - 1 && msg.role === 'user');
              
              return (
                <div key={index} className={`message-block ${isPrevious ? 'previous' : 'current'}`}>
                  {msg.role === 'user' ? (
                    <p className="user-message">{msg.content}</p>
                  ) : (
                    <p className="model-message">{msg.content}</p>
                  )}
                </div>
              );
            })}
            
            {isTyping && (
              <div className="message-block current typing-block">
                <p className="model-message typing">
                  {displayedText}
                  <span className="cursor">|</span>
                </p>
              </div>
            )}
            
            {isLoading && !isTyping && (
              <div className="message-block current">
                <p className="model-message">...</p>
              </div>
            )}
            
            <div ref={chatEndRef} />
          </div>
          
          <div className="input-container">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type here"
              disabled={isLoading || isTyping}
              className="text-input"
            />
            <div className="enter-hint">Press Enter</div>
          </div>
        </div>
      </div>
    );
  }

  // --- RENDER: Metrics Collection Screen ---
  if (currentPage === 'metrics') {
    return (
      <div className="container">
        <div className="goal-selection">
          <h1 className="welcome-title">Tell us about yourself</h1>
          <p className="welcome-subtitle">Adjust the sliders to set your metrics</p>
          
          <div className="metrics-form">
            {/* Age Slider */}
            <div className="metric-input-group">
              <label className="metric-label">Age</label>
              <div className="metric-value-display">{metrics.age}</div>
              <input
                type="range"
                min="15"
                max="80"
                value={metrics.age}
                onChange={(e) => setMetrics({...metrics, age: parseInt(e.target.value)})}
                className="metric-slider"
              />
            </div>

            {/* Height Slider */}
            <div className="metric-input-group">
              <label className="metric-label">Height (cm)</label>
              <div className="metric-value-display">{metrics.height_cm}</div>
              <input
                type="range"
                min="140"
                max="220"
                value={metrics.height_cm}
                onChange={(e) => setMetrics({...metrics, height_cm: parseInt(e.target.value)})}
                className="metric-slider"
              />
            </div>

            {/* Weight Slider */}
            <div className="metric-input-group">
              <label className="metric-label">Weight (kg)</label>
              <div className="metric-value-display">{metrics.weight_kg}</div>
              <input
                type="range"
                min="40"
                max="150"
                value={metrics.weight_kg}
                onChange={(e) => setMetrics({...metrics, weight_kg: parseInt(e.target.value)})}
                className="metric-slider"
              />
            </div>

            {/* Resting Heart Rate Slider */}
            <div className="metric-input-group">
              <label className="metric-label">Resting Heart Rate (BPM)</label>
              <div className="metric-value-display">{metrics.resting_bpm}</div>
              <input
                type="range"
                min="45"
                max="100"
                value={metrics.resting_bpm}
                onChange={(e) => setMetrics({...metrics, resting_bpm: parseInt(e.target.value)})}
                className="metric-slider"
              />
            </div>

            <button 
              className="goal-button" 
              onClick={handleMetricsSubmit}
              disabled={isLoading}
              style={{marginTop: '20px'}}
            >
              {isLoading ? 'Creating Your Profile...' : 'Complete Setup'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- RENDER: Dashboard ---
  if (currentPage === 'dashboard' && userProfile) {
    return (
      <div className="container">
        <div className="dashboard-container">
          <div className="dashboard-header">
            <h1 className="dashboard-title">Your Fitness Dashboard</h1>
            <p className="dashboard-subtitle">Track your progress and stay motivated</p>
          </div>

          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="card-title">Your Goal</div>
              <div className="card-content">
                <p>{selectedGoal}</p>
                <p style={{fontSize: '14px', marginTop: '10px', opacity: 0.7}}>
                  {userProfile.goals?.join(', ')}
                </p>
              </div>
            </div>

            <div className="dashboard-card">
              <div className="card-title">Fitness Score</div>
              <div className="metric-value">{(userProfile.fitness_score * 100).toFixed(0)}%</div>
              <div className="card-content">
                Experience Level: {userProfile.experience_level === 3 ? 'Advanced' : userProfile.experience_level === 2 ? 'Intermediate' : 'Beginner'}
              </div>
            </div>

            <div className="dashboard-card">
              <div className="card-title">Key Metrics</div>
              <div className="card-content">
                <p>Age: {metrics.age}</p>
                <p>Weight: {metrics.weight_kg} kg</p>
                <p>Height: {metrics.height_cm} cm</p>
                <p>Resting BPM: {metrics.resting_bpm}</p>
              </div>
            </div>

            <div className="dashboard-card">
              <div className="card-title">Journal Sentiment Trend</div>
              <div className="card-content" style={{fontSize: '14px', marginBottom: '10px'}}>
                Track your mental & physical recovery over the past week
              </div>
              <div className="simple-chart">
                {journalHistory.map((entry, index) => {
                  const height = `${entry.sentiment * 100}%`;
                  let gradient;
                  if (entry.sentiment >= 0.7) {
                    gradient = 'linear-gradient(to top, #4caf50, #2e7d32)';
                  } else if (entry.sentiment >= 0.5) {
                    gradient = 'linear-gradient(to top, #ffc107, #ff9800)';
                  } else {
                    gradient = 'linear-gradient(to top, #ff9800, #f57c00)';
                  }
                  
                  return (
                    <div key={index} className="chart-bar" style={{height, background: gradient}}>
                      <div className="chart-label">{entry.day}</div>
                    </div>
                  );
                })}
              </div>
              <div className="chart-legend">
                <span style={{color: '#4caf50'}}>● High Recovery</span>
                <span style={{color: '#ffc107', marginLeft: '15px'}}>● Moderate</span>
                <span style={{color: '#ff9800', marginLeft: '15px'}}>● Low/Stressed</span>
              </div>
            </div>

            <div className="dashboard-card" style={{gridColumn: 'span 2'}}>
              <div className="card-title">Weekly Workout Progress</div>
              <div className="card-content">
                <div style={{fontSize: '48px', fontWeight: '300', color: '#1565c0', margin: '20px 0'}}>
                  {workoutStats.completed} / {workoutStats.goal}
                </div>
                <div style={{fontSize: '16px', marginBottom: '20px'}}>
                  Workouts completed this week
                </div>
                <div className="progress-bar-container">
                  <div 
                    className="progress-bar-fill" 
                    style={{width: `${workoutStats.percentage}%`}}
                  ></div>
                </div>
                <div style={{fontSize: '14px', marginTop: '15px', opacity: 0.7}}>
                  {workoutStats.remaining > 0 
                    ? `${workoutStats.remaining} more ${workoutStats.remaining === 1 ? 'workout' : 'workouts'} to reach your weekly goal`
                    : '🎉 Weekly goal achieved!'}
                </div>
              </div>
            </div>

            <div className="dashboard-card" style={{gridColumn: 'span 2'}}>
              <div className="card-title">Journal Summary</div>
              <div className="card-content">
                <p>Track your workouts and mental state to get personalized insights.</p>
                <p style={{fontSize: '14px', marginTop: '10px', opacity: 0.7}}>
                  Recent entries will appear here once you start journaling.
                </p>
              </div>
            </div>
          </div>

          <div className="nav-buttons">
            <button className="nav-button" onClick={() => setCurrentPage('journal')}>
              Open Journal
            </button>
            <button className="nav-button" onClick={() => window.location.reload()}>
              Start Over
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- RENDER: Journal Page ---
  if (currentPage === 'journal' && userProfile) {
    return (
      <div className="container">
        <div className="journal-container">
          <div className="journal-header">
            <h1 className="dashboard-title">Fitness Journal</h1>
            <p className="welcome-subtitle">Log your workout and mental state</p>
          </div>

          <div className="journal-input-area">
            <textarea
              className="journal-textarea"
              placeholder="How did your workout go today? How are you feeling mentally and physically?"
              value={journalEntry}
              onChange={(e) => setJournalEntry(e.target.value)}
            />
            <button 
              className="goal-button" 
              onClick={handleJournalSubmit}
              disabled={isLoading || !journalEntry.trim()}
              style={{width: '100%', marginTop: '20px'}}
            >
              {isLoading ? 'Analyzing...' : 'Submit Entry'}
            </button>
          </div>

          {journalResult && (
            <div className="journal-results">
              <div className="card-title">AI Analysis</div>
              <div className="card-content">
                <p><strong>Sentiment Score:</strong> {journalResult.score}</p>
                <p style={{marginTop: '15px'}}><strong>Observation:</strong></p>
                <p>{journalResult.observation}</p>
                
                {journalResult.tags && journalResult.tags.length > 0 && (
                  <>
                    <p style={{marginTop: '15px'}}><strong>Context Tags:</strong></p>
                    <p>{journalResult.tags.join(', ')}</p>
                  </>
                )}

                {journalResult.safety_flag && (
                  <p style={{marginTop: '15px', color: '#ff6b6b'}}>
                    <strong>Note:</strong> High stress detected. Consider reaching out to a professional.
                  </p>
                )}
              </div>
            </div>
          )}

          <div className="nav-buttons">
            <button className="nav-button" onClick={() => setCurrentPage('dashboard')}>
              Back to Dashboard
            </button>
            <button className="nav-button" onClick={() => {
              setJournalEntry('');
              setJournalResult(null);
            }}>
              New Entry
            </button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}

export default App
