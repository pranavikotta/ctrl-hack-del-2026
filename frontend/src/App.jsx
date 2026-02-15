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

  // State for user profile card (fetched from /profile/{user_id})
  const [profileData, setProfileData] = useState(null);
  const [profileExpanded, setProfileExpanded] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileEdits, setProfileEdits] = useState({});

  // Schedule/Calendar state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [calendarScroll, setCalendarScroll] = useState(0);
  const [editingSchedule, setEditingSchedule] = useState({
    Monday: { enabled: false, time: 'morning' },
    Tuesday: { enabled: false, time: 'morning' },
    Wednesday: { enabled: false, time: 'morning' },
    Thursday: { enabled: false, time: 'morning' },
    Friday: { enabled: false, time: 'morning' },
    Saturday: { enabled: false, time: 'morning' },
    Sunday: { enabled: false, time: 'morning' }
  });

  // State for typing animation
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);

  // Auto-scroll to bottom of chat
  const chatEndRef = useRef(null);
  const calendarBodyRef = useRef(null);
  
  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(scrollToBottom, [messages, displayedText]);

  // Fetch dashboard data when user profile is loaded
  useEffect(() => {
    if (userProfile && currentPage === 'dashboard') {
      fetchDashboardData();
      // ALSO fetch profile data immediately for the profile card
      if (!profileData) {
        fetchUserProfile(userProfile.user_id);
      }
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
        // Calculate missing fields if backend doesn't provide them
        const completed = statsData.completed || 0;
        const goal = statsData.goal || 0;
        const percentage = statsData.percentage ?? (goal === 0 ? 0 : Math.round((completed / goal) * 100));
        const remaining = statsData.remaining ?? Math.max(0, goal - completed);
        
        setWorkoutStats({
          completed,
          goal,
          percentage,
          remaining
        });
      }

      // Fetch biometric profile for the profile card
      fetchUserProfile(userProfile.user_id);
    } catch (error) {
      console.error("Error fetching dashboard data:", error);
    }
  };

  const fetchUserProfile = async (userId) => {
    console.log('[DEBUG] Fetching profile for user:', userId);
    setProfileLoading(true);
    try {
      const response = await fetch(`http://127.0.0.1:8000/profile/${userId}`);
      const data = await response.json();
      console.log('[DEBUG] Profile data received:', data);
      if (data && !data.error) {
        setProfileData(data);
        console.log('[DEBUG] Profile state updated');
      } else {
        console.error('[DEBUG] Profile fetch error:', data.error);
      }
    } catch (error) {
      console.error('[DEBUG] Profile fetch exception:', error);
    } finally {
      setProfileLoading(false);
    }
  };

  const handleProfileSave = async () => {
    if (!userProfile || !profileData) return;
    setProfileSaving(true);
    try {
      // Recalculate derived fields locally
      const weight = parseFloat(profileEdits.weight_kg ?? profileData.weight_kg);
      const height_cm = parseFloat(profileEdits.height_cm ?? profileData.height_cm);
      const age = parseInt(profileEdits.age ?? profileData.age);
      const resting_bpm = parseInt(profileEdits.resting_bpm ?? profileData.resting_bpm);

      const response = await fetch(
        `http://127.0.0.1:8000/profile/${userProfile.user_id}`,
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ weight_kg: weight, height_cm, age, resting_bpm }),
        }
      );
      const data = await response.json();
      
      if (data.status === 'updated') {
        // Update local state with ALL returned values including recalculated fitness_score
        setProfileData(prev => ({
          ...prev,
          age: data.age,
          height_cm: data.height_cm,
          weight_kg: data.weight_kg,
          resting_bpm: data.resting_bpm,
          fitness_score: data.fitness_score, // This gets recalculated by backend
          experience_level: data.experience_level
        }));
        
        // Also update userProfile if needed
        setUserProfile(prev => ({
          ...prev,
          fitness_score: data.fitness_score,
          experience_level: data.experience_level
        }));
        
        setProfileEditing(false);
        setProfileEdits({});
        console.log('Profile saved successfully:', data);
      } else {
        alert('Save failed: ' + (data.message || 'Unknown error'));
      }
    } catch (err) {
      console.error('Profile save error:', err);
      alert('Could not reach server.');
    } finally {
      setProfileSaving(false);
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

  const handleScheduleSave = async () => {
    // Convert editingSchedule to schedule string
    const enabledDays = Object.entries(editingSchedule)
      .filter(([_, data]) => data.enabled)
      .map(([day, data]) => `${day} ${data.time}`)
      .join(', ');
    
    const workoutsPerWeek = Object.values(editingSchedule).filter(d => d.enabled).length;
    
    try {
      setIsLoading(true);
      const response = await fetch('http://127.0.0.1:8000/update_schedule', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: userProfile.user_id,
          schedule: enabledDays,
          workouts_per_week: workoutsPerWeek
        }),
      });

      const data = await response.json();
      
      if (data.status === 'success') {
        // Update local state
        setUserProfile({
          ...userProfile,
          ai_extracted_data: {
            ...userProfile.ai_extracted_data,
            schedule: enabledDays
          },
          workouts_per_week: workoutsPerWeek
        });
        setShowScheduleModal(false);
      }
    } catch (error) {
      console.error("Error updating schedule:", error);
      alert('Failed to update schedule');
    } finally {
      setIsLoading(false);
    }
  };

  // --- RENDER: Logo Component (appears on all pages) ---
  const Logo = () => (
    <div className="app-logo">
      <img src="/CadenceAILogo.png" alt="Fitness App Logo" />
    </div>
  );

  // --- RENDER: Goal Selection Screen ---
  if (currentPage === 'goal-selection') {
    return (
      <>
        <Logo />
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
      </>
    );
  }

  // --- RENDER: Chat Screen ---
  if (currentPage === 'chat') {
    return (
      <>
        <Logo />
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
      </>
    );
  }

  // --- RENDER: Metrics Collection Screen ---
  if (currentPage === 'metrics') {
    return (
      <>
        <Logo />
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
      </>
    );
  }

  // --- RENDER: Dashboard ---
  if (currentPage === 'dashboard' && userProfile) {
    // Parse schedule from userProfile
    const schedule = userProfile?.ai_extracted_data?.schedule || '';
    
    return (
      <>
        <Logo />
        <div className="container">
          <div className="dashboard-container">
            <div className="dashboard-header">
              <h1 className="dashboard-title">Your Fitness Dashboard</h1>
              <p className="dashboard-subtitle">Track your progress and stay motivated</p>
            </div>

            <div className="dashboard-grid">
              {/* Calendar Schedule - Apple Calendar Style */}
              <div className="dashboard-card schedule-card">
                <div className="card-title">Your Weekly Schedule</div>
                <div className="calendar-container">
                  {/* Day Headers */}
                  <div className="calendar-header">
                    <div className="time-column-header"></div>
                    {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day) => (
                      <div 
                        key={day} 
                        className="day-header clickable"
                        onClick={() => setShowScheduleModal(true)}
                        title="Click to edit schedule"
                      >
                        {day}
                      </div>
                    ))}
                  </div>
                  
                  {/* Scrollable Time Grid */}
                  <div 
                    className="calendar-body" 
                    ref={calendarBodyRef}
                    onScroll={(e) => setCalendarScroll(e.target.scrollTop)}
                  >
                    {/* Time labels column */}
                    <div className="time-column">
                      {Array.from({ length: 24 }, (_, i) => {
                        const hour = i;
                        const displayHour = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour;
                        const period = hour < 12 ? 'AM' : 'PM';
                        return (
                          <div key={hour} className="time-label">
                            {displayHour}:00 {period}
                          </div>
                        );
                      })}
                    </div>
                    
                    {/* Days grid */}
                    <div className="days-grid">
                      {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((fullDay, dayIndex) => {
                        const schedule = userProfile.ai_extracted_data?.schedule || '';
                        const scheduleLower = schedule.toLowerCase();
                        
                        // Check if this specific day is mentioned in schedule
                        const dayLower = fullDay.toLowerCase();
                        const dayInSchedule = scheduleLower.includes(dayLower);
                        
                        // Determine workout time range for THIS SPECIFIC DAY
                        let workoutStart = -1;
                        let workoutEnd = -1;
                        
                        if (dayInSchedule) {
                          // Extract the time for this specific day
                          // Pattern: "monday morning" or "wednesday afternoon"
                          const dayPattern = new RegExp(`${dayLower}\\s+(morning|afternoon|evening)`, 'i');
                          const match = schedule.match(dayPattern);
                          
                          if (match) {
                            const timeOfDay = match[1].toLowerCase();
                            if (timeOfDay === 'morning') {
                              workoutStart = 6;
                              workoutEnd = 10;
                            } else if (timeOfDay === 'afternoon') {
                              workoutStart = 13;
                              workoutEnd = 17;
                            } else if (timeOfDay === 'evening') {
                              workoutStart = 17;
                              workoutEnd = 21;
                            }
                          } else {
                            // Fallback: check for general time mentions
                            if (scheduleLower.includes('morning')) {
                              workoutStart = 6;
                              workoutEnd = 10;
                            } else if (scheduleLower.includes('afternoon')) {
                              workoutStart = 13;
                              workoutEnd = 17;
                            } else if (scheduleLower.includes('evening')) {
                              workoutStart = 17;
                              workoutEnd = 21;
                            } else {
                              // Default to afternoon
                              workoutStart = 13;
                              workoutEnd = 17;
                            }
                          }
                        }
                        
                        // Get current day info
                        const today = new Date();
                        const currentDayIndex = today.getDay();
                        const adjustedCurrentDay = currentDayIndex === 0 ? 6 : currentDayIndex - 1;
                        
                        const isPast = dayIndex < adjustedCurrentDay;
                        const isToday = dayIndex === adjustedCurrentDay;
                        const isFuture = dayIndex > adjustedCurrentDay;
                        
                        // Find journal entry for this day
                        const dayAbbrev = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'][dayIndex];
                        const journalEntry = journalHistory.find(entry => entry.day === dayAbbrev);
                        const sentiment = journalEntry ? journalEntry.sentiment : null;
                        
                        // Determine block status
                        let blockStatus = 'none';
                        if (dayInSchedule && workoutStart !== -1) {
                          if (sentiment !== null) {
                            // Color based on journal sentiment
                            if (sentiment >= 0.7) blockStatus = 'completed-high';
                            else if (sentiment >= 0.5) blockStatus = 'completed-moderate';
                            else blockStatus = 'completed-low';
                          } else {
                            // No journal yet - show as white/upcoming
                            blockStatus = 'upcoming';
                          }
                        }

                        // Calculate sticky indicator visibility
                        const HOUR_HEIGHT = 60;
                        const CONTAINER_HEIGHT = 300; // calendar-body height
                        const workoutStartPx = workoutStart * HOUR_HEIGHT;
                        const workoutEndPx = workoutEnd * HOUR_HEIGHT;
                        const viewportTop = calendarScroll;
                        const viewportBottom = calendarScroll + CONTAINER_HEIGHT;

                        // Check if workout is above or below viewport
                        const isAboveViewport = workoutEndPx < viewportTop;
                        const isBelowViewport = workoutStartPx > viewportBottom;
                        const isPartiallyVisible = workoutStartPx < viewportTop && workoutEndPx > viewportTop;

                        // Calculate indicator height when expanding into view
                        let topIndicatorHeight = 24; // default height
                        let bottomIndicatorHeight = 24;

                        if (isPartiallyVisible) {
                          // Expanding from top as we scroll down
                          topIndicatorHeight = Math.min(workoutEndPx - viewportTop, workoutEndPx - workoutStartPx);
                        }

                        const isPartiallyVisibleBottom = workoutStartPx < viewportBottom && workoutEndPx > viewportBottom;
                        if (isPartiallyVisibleBottom) {
                          // Expanding from bottom as we scroll up
                          bottomIndicatorHeight = Math.min(viewportBottom - workoutStartPx, workoutEndPx - workoutStartPx);
                        }
                        
                        return (
                          <div key={fullDay} className="day-column">
                            {/* Top sticky indicator - shows when workout is above viewport */}
                            {isAboveViewport && blockStatus !== 'none' && (
                              <div 
                                className={`sticky-indicator top ${blockStatus}`}
                                style={{ height: '24px' }}
                              />
                            )}

                            {/* Expanding top indicator - shows when scrolling into workout from below */}
                            {isPartiallyVisible && blockStatus !== 'none' && (
                              <div 
                                className={`sticky-indicator top expanding ${blockStatus}`}
                                style={{ height: `${topIndicatorHeight}px` }}
                              />
                            )}

                            {Array.from({ length: 24 }, (_, hour) => {
                              const hasWorkout = hour >= workoutStart && hour < workoutEnd;
                              const isFirstBlock = hour === workoutStart;
                              const isLastBlock = hour === workoutEnd - 1;
                              const isMiddleBlock = hasWorkout && !isFirstBlock && !isLastBlock;
                              
                              return (
                                <div
                                  key={`${fullDay}-${hour}`}
                                  className={`time-block ${hasWorkout ? 'workout-block' : ''} ${isFirstBlock ? 'first-block' : ''} ${isLastBlock ? 'last-block' : ''} ${isMiddleBlock ? 'middle-block' : ''}`}
                                >
                                  {hasWorkout && (
                                    <div className={`workout-pill ${blockStatus} ${isFirstBlock ? 'first' : ''} ${isLastBlock ? 'last' : ''} ${isMiddleBlock ? 'middle' : ''}`}>
                                      {isFirstBlock && (
                                        <>
                                        </>
                                      )}
                                    </div>
                                  )}
                                </div>
                              );
                            })}

                            {/* Bottom sticky indicator - shows when workout is below viewport */}
                            {isBelowViewport && blockStatus !== 'none' && (
                              <div 
                                className={`sticky-indicator bottom ${blockStatus}`}
                                style={{ height: '24px' }}
                              />
                            )}

                            {/* Expanding bottom indicator - shows when scrolling into workout from above */}
                            {isPartiallyVisibleBottom && blockStatus !== 'none' && (
                              <div 
                                className={`sticky-indicator bottom expanding ${blockStatus}`}
                                style={{ height: `${bottomIndicatorHeight}px` }}
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
                
                {/* Legend */}
                <div className="calendar-legend">
                  <div className="legend-item">
                    <div className="legend-box upcoming"></div>
                    <span>Upcoming Workout</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-box completed-high"></div>
                    <span>Completed - High Recovery</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-box completed-moderate"></div>
                    <span>Completed - Moderate</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-box completed-low"></div>
                    <span>Completed - Low/Stressed</span>
                  </div>
                  <div className="legend-item">
                    <div className="legend-box missed"></div>
                    <span>No Journal Entry</span>
                  </div>
                </div>
                
                <div className="schedule-note">
                  {userProfile.ai_extracted_data?.schedule || 'No schedule set'}
                </div>
              </div>

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

              {/* Expandable User Profile Card */}
              <div
                className={`dashboard-card profile-card${profileExpanded ? ' profile-card--expanded' : ''}`}
                style={profileExpanded ? {
                  position: 'fixed', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  zIndex: 1000, width: '90%', maxWidth: '700px',
                  maxHeight: '85vh', overflowY: 'auto', padding: '40px',
                } : { justifyContent: 'flex-start', gridColumn: 'span 1' }}
              >
                {/* Backdrop */}
                {profileExpanded && (
                  <div onClick={() => { setProfileExpanded(false); setProfileEditing(false); setProfileEdits({}); }}
                    style={{ position: 'fixed', inset: 0, background: 'rgba(21,101,192,0.08)',
                      backdropFilter: 'blur(4px)', zIndex: -1 }} />
                )}

                {/* ── Title row — always at top ── */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  width: '100%', marginBottom: profileExpanded ? '24px' : '12px' }}>
                  <div className="card-title" style={{ margin: 0 }}>User Profile</div>
                  {profileExpanded && profileData && !profileEditing && (
                    <button
                      onClick={() => { setProfileEditing(true); setProfileEdits({}); }}
                      style={{ padding: '6px 14px', fontSize: '13px', borderRadius: '10px',
                        background: 'rgba(100,181,246,0.12)', border: '1.5px solid rgba(100,181,246,0.35)',
                        color: '#1565c0', cursor: 'pointer', marginTop: 0, boxShadow: 'none' }}>
                      ✏️ Edit
                    </button>
                  )}
                  {profileExpanded && profileEditing && (
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button
                        onClick={handleProfileSave} disabled={profileSaving}
                        style={{ padding: '6px 14px', fontSize: '13px', borderRadius: '10px',
                          background: 'rgba(100,181,246,0.2)', border: '1.5px solid rgba(100,181,246,0.5)',
                          color: '#1565c0', cursor: 'pointer', marginTop: 0, boxShadow: 'none' }}>
                        {profileSaving ? 'Saving…' : '💾 Save'}
                      </button>
                      <button
                        onClick={() => { setProfileEditing(false); setProfileEdits({}); }}
                        style={{ padding: '6px 14px', fontSize: '13px', borderRadius: '10px',
                          background: 'rgba(255,255,255,0.4)', border: '1.5px solid rgba(100,181,246,0.2)',
                          color: '#90caf9', cursor: 'pointer', marginTop: 0, boxShadow: 'none' }}>
                        Cancel
                      </button>
                    </div>
                  )}
                </div>

                {/* ── Collapsed view: summary pills ── */}
                {!profileExpanded && (
                  <div className="card-content" style={{ gap: '6px', width: '100%' }}>
                    {profileLoading ? (
                      <p style={{ opacity: 0.5, fontSize: '14px' }}>Loading…</p>
                    ) : profileData ? (
                      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'center' }}>
                        {[
                          { label: 'Age',    value: `${profileData.age} yrs` },
                          { label: 'BMI',    value: profileData.bmi || Math.round((profileData.weight_kg / ((profileData.height_cm / 100) ** 2)) * 10) / 10 },
                          { label: 'BPM',    value: profileData.resting_bpm },
                        ].map(item => (
                          <div key={item.label} style={{
                            background: 'rgba(100,181,246,0.1)', border: '1px solid rgba(100,181,246,0.25)',
                            borderRadius: '10px', padding: '6px 14px', fontSize: '14px',
                            color: '#1565c0', textAlign: 'center' }}>
                            <span style={{ opacity: 0.6, display: 'block', fontSize: '11px', marginBottom: '2px' }}>{item.label}</span>
                            <strong>{item.value}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p style={{ opacity: 0.5, fontSize: '14px' }}>Loading profile...</p>
                    )}
                  </div>
                )}

                {/* ── Expanded view ── */}
                {profileExpanded && (
                  <div style={{ width: '100%' }}>
                    {profileLoading ? (
                      <p style={{ textAlign: 'center', color: '#64b5f6', opacity: 0.6 }}>Fetching your data…</p>
                    ) : profileData ? (
                      <>
                        {/* Editable fields: Age / Height / Weight */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                          gap: '16px', marginBottom: '24px' }}>
                          {[
                            { key: 'age',       label: 'Age',    unit: 'yrs', icon: '🎂', min: 15, max: 80,  step: 1,   editable: true },
                            { key: 'height_cm', label: 'Height', unit: 'cm',  icon: '📏', min: 140, max: 220, step: 1,   editable: true },
                            { key: 'weight_kg', label: 'Weight', unit: 'kg',  icon: '⚖️', min: 40,  max: 150, step: 0.5, editable: true },
                          ].map(field => {
                            const current = profileEdits[field.key] !== undefined
                              ? profileEdits[field.key]
                              : profileData[field.key];
                            return (
                              <div key={field.key} style={{
                                background: profileEditing ? 'rgba(100,181,246,0.06)' : 'rgba(255,255,255,0.55)',
                                backdropFilter: 'blur(12px)',
                                border: profileEditing ? '1.5px solid rgba(100,181,246,0.4)' : '1.5px solid rgba(100,181,246,0.25)',
                                borderRadius: '16px', padding: '18px 14px', textAlign: 'center',
                                transition: 'all 0.3s ease' }}>
                                <div style={{ fontSize: '22px', marginBottom: '6px' }}>{field.icon}</div>
                                <div style={{ fontSize: '26px', fontWeight: '300', color: '#1565c0', lineHeight: 1 }}>{current}</div>
                                <div style={{ fontSize: '13px', color: '#90caf9', marginTop: '4px' }}>{field.unit}</div>
                                <div style={{ fontSize: '11px', color: '#64b5f6', marginTop: '5px', fontWeight: '500',
                                  letterSpacing: '0.5px', textTransform: 'uppercase' }}>{field.label}</div>
                                {profileEditing && (
                                  <input type="range" min={field.min} max={field.max} step={field.step}
                                    value={current}
                                    onChange={e => setProfileEdits(prev => ({
                                      ...prev,
                                      [field.key]: field.step < 1 ? parseFloat(e.target.value) : parseInt(e.target.value)
                                    }))}
                                    className="metric-slider"
                                    style={{ marginTop: '10px', width: '100%' }} />
                                )}
                              </div>
                            );
                          })}
                        </div>

                        <div style={{ height: '1px', background: 'rgba(100,181,246,0.15)', margin: '0 0 20px' }} />

                        {/* Heart metrics row — resting BPM is editable, max BPM & BMI auto-recalculate */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                          gap: '16px', marginBottom: '24px' }}>

                          {/* Resting BPM — editable */}
                          {(() => {
                            const val = profileEdits.resting_bpm !== undefined ? profileEdits.resting_bpm : profileData.resting_bpm;
                            return (
                              <div style={{ background: profileEditing ? 'rgba(100,181,246,0.06)' : 'rgba(255,255,255,0.55)',
                                backdropFilter: 'blur(12px)', border: profileEditing
                                  ? '1.5px solid rgba(100,181,246,0.4)' : '1.5px solid #64b5f640',
                                borderRadius: '16px', padding: '18px 14px', textAlign: 'center',
                                transition: 'all 0.3s ease' }}>
                                <div style={{ fontSize: '24px', marginBottom: '6px' }}>💙</div>
                                <div style={{ fontSize: '32px', fontWeight: '300', color: '#64b5f6', lineHeight: 1 }}>{val}</div>
                                <div style={{ fontSize: '11px', color: '#64b5f6', marginTop: '5px', fontWeight: '500',
                                  textTransform: 'uppercase', letterSpacing: '0.5px' }}>Resting BPM</div>
                                <div style={{ fontSize: '11px', color: '#90caf9', marginTop: '3px', opacity: 0.7 }}>Heart rate at rest</div>
                                {profileEditing && (
                                  <input type="range" min={40} max={100} step={1} value={val}
                                    onChange={e => setProfileEdits(prev => ({ ...prev, resting_bpm: parseInt(e.target.value) }))}
                                    className="metric-slider" style={{ marginTop: '10px', width: '100%' }} />
                                )}
                              </div>
                            );
                          })()}

                          {/* Max BPM — read-only, recalculates from age */}
                          {(() => {
                            const age = profileEdits.age !== undefined ? profileEdits.age : profileData.age;
                            const maxBpm = 220 - age;
                            return (
                              <div style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(12px)',
                                border: '1.5px solid #ef9a9a40', borderRadius: '16px', padding: '18px 14px', textAlign: 'center' }}>
                                <div style={{ fontSize: '24px', marginBottom: '6px' }}>❤️‍🔥</div>
                                <div style={{ fontSize: '32px', fontWeight: '300', color: '#ef9a9a', lineHeight: 1 }}>{maxBpm}</div>
                                <div style={{ fontSize: '11px', color: '#64b5f6', marginTop: '5px', fontWeight: '500',
                                  textTransform: 'uppercase', letterSpacing: '0.5px' }}>Max BPM</div>
                                <div style={{ fontSize: '11px', color: '#90caf9', marginTop: '3px', opacity: 0.7 }}>220 − age formula</div>
                              </div>
                            );
                          })()}

                          {/* BMI — read-only, recalculates live */}
                          {(() => {
                            const weight = profileEdits.weight_kg !== undefined ? profileEdits.weight_kg : profileData.weight_kg;
                            const height = profileEdits.height_cm !== undefined ? profileEdits.height_cm : profileData.height_cm;
                            const bmi = Math.round((weight / ((height / 100) ** 2)) * 10) / 10;
                            const bmiColor = bmi < 18.5 ? '#ffd54f' : bmi < 25 ? '#66bb6a' : bmi < 30 ? '#ffa726' : '#ef9a9a';
                            const bmiLabel = bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Healthy' : bmi < 30 ? 'Overweight' : 'Obese';
                            return (
                              <div style={{ background: 'rgba(255,255,255,0.55)', backdropFilter: 'blur(12px)',
                                border: `1.5px solid ${bmiColor}40`, borderRadius: '16px', padding: '18px 14px', textAlign: 'center' }}>
                                <div style={{ fontSize: '24px', marginBottom: '6px' }}>📊</div>
                                <div style={{ fontSize: '32px', fontWeight: '300', color: bmiColor, lineHeight: 1 }}>{bmi}</div>
                                <div style={{ fontSize: '11px', color: '#64b5f6', marginTop: '5px', fontWeight: '500',
                                  textTransform: 'uppercase', letterSpacing: '0.5px' }}>BMI</div>
                                <div style={{ fontSize: '11px', marginTop: '3px', opacity: 0.75, color: bmiColor }}>{bmiLabel}</div>
                              </div>
                            );
                          })()}
                        </div>

                        {/* Heart Rate Zones — recalculate from current age */}
                        {(() => {
                          const age = profileEdits.age !== undefined ? profileEdits.age : profileData.age;
                          const maxBpm = 220 - age;
                          return (
                            <div style={{ background: 'rgba(255,255,255,0.45)', backdropFilter: 'blur(12px)',
                              border: '1.5px solid rgba(100,181,246,0.2)', borderRadius: '16px', padding: '20px 24px' }}>
                              <div style={{ fontSize: '13px', color: '#64b5f6', fontWeight: '500',
                                textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '12px' }}>
                                Heart Rate Zones
                              </div>
                              {[
                                { label: 'Zone 1 — Warm Up', pctLow: 50, pctHigh: 60, color: '#b3e5fc' },
                                { label: 'Zone 2 — Fat Burn', pctLow: 60, pctHigh: 70, color: '#64b5f6' },
                                { label: 'Zone 3 — Cardio',  pctLow: 70, pctHigh: 80, color: '#42a5f5' },
                                { label: 'Zone 4 — Peak',    pctLow: 80, pctHigh: 90, color: '#1976d2' },
                              ].map(zone => {
                                const low  = Math.round(maxBpm * zone.pctLow  / 100);
                                const high = Math.round(maxBpm * zone.pctHigh / 100);
                                return (
                                  <div key={zone.label} style={{ display: 'flex', alignItems: 'center',
                                    gap: '12px', marginBottom: '8px' }}>
                                    <div style={{ width: '110px', fontSize: '12px', color: '#64b5f6',
                                      textAlign: 'right', flexShrink: 0 }}>{zone.label}</div>
                                    <div style={{ flex: 1, height: '10px', background: 'rgba(100,181,246,0.1)',
                                      borderRadius: '5px', overflow: 'hidden' }}>
                                      <div style={{ marginLeft: `${zone.pctLow - 50}%`,
                                        width: `${zone.pctHigh - zone.pctLow}%`, height: '100%',
                                        background: zone.color, borderRadius: '5px', opacity: 0.85 }} />
                                    </div>
                                    <div style={{ width: '72px', fontSize: '12px', color: '#90caf9', flexShrink: 0 }}>
                                      {low}–{high} bpm
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          );
                        })()}

                        {profileEditing && (
                          <p style={{ fontSize: '12px', color: '#90caf9', textAlign: 'center',
                            marginTop: '16px', opacity: 0.7 }}>
                            BMI and Max BPM update live as you adjust. Hit Save to persist changes.
                          </p>
                        )}

                        {/* Edit/Save/Cancel buttons */}
                        <div style={{ display: 'flex', gap: '10px', justifyContent: 'center', marginTop: '20px' }}>
                          {!profileEditing ? (
                            <button
                              onClick={() => setProfileEditing(true)}
                              style={{
                                background: 'rgba(100,181,246,0.15)',
                                border: '1.5px solid rgba(100,181,246,0.35)',
                                color: '#1565c0',
                                padding: '10px 24px',
                                borderRadius: '12px',
                                fontSize: '14px',
                                fontWeight: '500',
                                cursor: 'pointer',
                                transition: 'all 0.3s ease'
                              }}>
                              ✏️ Edit Metrics
                            </button>
                          ) : (
                            <>
                              <button
                                onClick={handleProfileSave}
                                disabled={profileSaving}
                                style={{
                                  background: profileSaving ? 'rgba(100,181,246,0.1)' : 'rgba(76,175,80,0.15)',
                                  border: '1.5px solid rgba(76,175,80,0.4)',
                                  color: '#2e7d32',
                                  padding: '10px 24px',
                                  borderRadius: '12px',
                                  fontSize: '14px',
                                  fontWeight: '500',
                                  cursor: profileSaving ? 'not-allowed' : 'pointer',
                                  transition: 'all 0.3s ease',
                                  opacity: profileSaving ? 0.6 : 1
                                }}>
                                {profileSaving ? '💾 Saving...' : '💾 Save Changes'}
                              </button>
                              <button
                                onClick={() => {
                                  setProfileEditing(false);
                                  setProfileEdits({});
                                }}
                                disabled={profileSaving}
                                style={{
                                  background: 'rgba(244,67,54,0.1)',
                                  border: '1.5px solid rgba(244,67,54,0.3)',
                                  color: '#c62828',
                                  padding: '10px 24px',
                                  borderRadius: '12px',
                                  fontSize: '14px',
                                  fontWeight: '500',
                                  cursor: profileSaving ? 'not-allowed' : 'pointer',
                                  transition: 'all 0.3s ease',
                                  opacity: profileSaving ? 0.6 : 1
                                }}>
                                ✖️ Cancel
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    ) : (
                      <p style={{ textAlign: 'center', color: '#64b5f6', opacity: 0.6 }}>
                        Could not load profile data. Is the server running?
                      </p>
                    )}
                  </div>
                )}

                {/* ── Expand / collapse button ── */}
                <button
                  onClick={() => {
                    if (!profileExpanded && !profileData && userProfile) fetchUserProfile(userProfile.user_id);
                    setProfileExpanded(v => !v);
                    setProfileEditing(false);
                    setProfileEdits({});
                  }}
                  style={{
                    position: 'absolute', bottom: '14px', right: '14px',
                    width: '30px', height: '30px', borderRadius: '50%',
                    background: 'rgba(100,181,246,0.15)',
                    border: '1.5px solid rgba(100,181,246,0.35)',
                    color: '#1565c0', fontSize: '15px',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', padding: 0, margin: 0, boxShadow: '0 2px 8px rgba(100,181,246,0.15)',
                  }}
                  title={profileExpanded ? 'Collapse' : 'Expand profile'}>
                  {profileExpanded ? '↙' : '↗'}
                </button>
              </div>

              <div className="dashboard-card" style={{gridColumn: 'span 1'}}>
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
                      style={{width: `${Math.max(0, Math.min(100, workoutStats.percentage || 0))}%`}}
                    ></div>
                  </div>
                  <div style={{fontSize: '14px', marginTop: '15px', opacity: 0.7}}>
                    {(workoutStats.remaining ?? 1) > 0
                      ? `${workoutStats.remaining || 0} more ${workoutStats.remaining === 1 ? 'workout' : 'workouts'} to reach your weekly goal`
                      : '🎉 Weekly goal achieved!'}
                  </div>
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

            {/* Schedule Editing Modal */}
            {showScheduleModal && (
              <div className="modal-overlay" onClick={() => setShowScheduleModal(false)}>
                <div className="modal-content" onClick={(e) => e.stopPropagation()}>
                  <div className="modal-header">
                    <h2>Edit Your Workout Schedule</h2>
                    <button className="modal-close" onClick={() => setShowScheduleModal(false)}>×</button>
                  </div>
                  
                  <div className="schedule-editor">
                    {Object.entries(editingSchedule).map(([day, data]) => (
                      <div key={day} className="day-editor">
                        <label className="day-checkbox">
                          <input
                            type="checkbox"
                            checked={data.enabled}
                            onChange={(e) => setEditingSchedule({
                              ...editingSchedule,
                              [day]: { ...data, enabled: e.target.checked }
                            })}
                          />
                          <span className="day-name-editor">{day}</span>
                        </label>
                        
                        {data.enabled && (
                          <select
                            value={data.time}
                            onChange={(e) => setEditingSchedule({
                              ...editingSchedule,
                              [day]: { ...data, time: e.target.value }
                            })}
                            className="time-selector"
                          >
                            <option value="morning">Morning (6am-10am)</option>
                            <option value="afternoon">Afternoon (1pm-5pm)</option>
                            <option value="evening">Evening (5pm-9pm)</option>
                          </select>
                        )}
                      </div>
                    ))}
                  </div>
                  
                  <div className="modal-footer">
                    <button className="modal-button cancel" onClick={() => setShowScheduleModal(false)}>
                      Cancel
                    </button>
                    <button 
                      className="modal-button save" 
                      onClick={handleScheduleSave}
                      disabled={isLoading}
                    >
                      {isLoading ? 'Saving...' : 'Save Changes'}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </>
    );
  }

  // --- RENDER: Journal Page ---
  if (currentPage === 'journal' && userProfile) {
    return (
      <>
        <Logo />
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
      </>
    );
  }

  return null;
}

export default App