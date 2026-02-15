import os
import re
import json
import joblib
import numpy as np
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
import google.generativeai as genai
from snowflake.connector import connect

# Import your models and prompts
from data_structure import UserProfile, UserJournal
from system_prompts import (
    ONBOARD_PROMPT, 
    JOURNAL_INPUT_PROMPT, 
    JOURNAL_OUTPUT_PROMPT, 
    SCHEDULE_GENERATOR_PROMPT
)

# 1. Load Environment Variables
load_dotenv()

app = FastAPI()

# Add CORS middleware to allow frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 2. Configuration from .env
SNOWFLAKE_CONFIG = {
    "user": os.getenv("SNOWFLAKE_USER"),
    "password": os.getenv("SNOWFLAKE_PASSWORD"),
    "account": os.getenv("SNOWFLAKE_ACCOUNT"),
    "warehouse": os.getenv("SNOWFLAKE_WAREHOUSE"),
    "database": os.getenv("SNOWFLAKE_DATABASE"),
    "schema": os.getenv("SNOWFLAKE_SCHEMA")
}

genai.configure(api_key=os.getenv("GEMINI_API_KEY"))

# Load ML models
fit_model = joblib.load('fitness_model.pkl')
fit_scaler = joblib.load('scaler.pkl')

class OnboardRequest(BaseModel):
    chat_history: List[Dict[str, str]]
    user_stats: Optional[Dict[str, Any]] = None

onboard_model = genai.GenerativeModel(
    model_name='gemini-2.0-flash',
    system_instruction=ONBOARD_PROMPT,
    generation_config={"temperature": 0.1}
)

journal_model = genai.GenerativeModel(
    model_name='gemini-2.0-flash',
    generation_config={"temperature": 0.7}
)

# --- ONBOARDING ENDPOINT ---

@app.post("/onboard")
async def onboard_user(data: List[Dict[str, str]]):
    """
    Expects array of chat messages: [{"role": "user", "content": "..."}, ...]
    """
    chat_history = data
    
    formatted_messages = []
    for msg in chat_history:
        role = "user" if msg["role"] == "user" else "model"
        formatted_messages.append({"role": role, "parts": [msg["content"]]})

    try:
        response = onboard_model.generate_content(formatted_messages)
        response_text = response.text
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        
        if json_match:
            raw_json = json.loads(json_match.group())
            
            # Return partial profile - metrics will be added later
            return {
                "status": "needs_metrics", 
                "partial_data": raw_json,
                "message": "Great! Now we need some metrics to personalize your experience."
            }

        return {"status": "chatting", "message": response_text}

    except Exception as e:
        print(f"ERROR: {str(e)}")
        return {"status": "error", "message": f"Server Error: {str(e)}"}


@app.post("/complete_profile")
async def complete_profile(profile_data: dict):
    """
    Receives complete profile with metrics and calculates fitness score
    """
    try:
        # Extract data
        age = float(profile_data.get("age", 0))
        weight = float(profile_data.get("weight_kg", 0))
        height_cm = float(profile_data.get("height_cm", 0))
        resting_bpm = float(profile_data.get("resting_bpm", 0))
        workout_freq = float(profile_data.get("workouts_per_week", 0))
        
        # Feature Engineering
        height_m = height_cm / 100
        bmi = weight / (height_m ** 2) if height_m > 0 else 0
        max_bpm = 220 - age
        
        # Arrange features matching training order
        input_features = np.array([[age, weight, height_m, resting_bpm, max_bpm, workout_freq, bmi]])
        
        # Scale and Predict
        scaled_input = fit_scaler.transform(input_features)
        fitness_proba = fit_model.predict_proba(scaled_input)[0][1]
        
        # Predict experience level (1-3)
        experience_prediction = fit_model.predict(scaled_input)[0]
        experience_level = int(experience_prediction) + 1  # Convert 0/1 to 1/2/3
        
        profile_data["fitness_score"] = round(float(fitness_proba), 2)
        profile_data["experience_level"] = experience_level
        
        # Create profile
        profile = UserProfile(**profile_data)
        
        # Save to Snowflake
        conn = connect(**SNOWFLAKE_CONFIG)
        cur = conn.cursor()
        try:
            query = """
            INSERT INTO USER_PROFILES (
                USER_ID, GOALS, WORKOUTS_PER_WEEK, AI_EXTRACTED_DATA, 
                FITNESS_SCORE, WEIGHT_KG, HEIGHT_CM, AGE, 
                RESTING_BPM, EXPERIENCE_LEVEL, CREATED_AT, BROAD_GOAL
            )
            VALUES (%s, PARSE_JSON(%s), %s, PARSE_JSON(%s), %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP(), %s)
            """
            cur.execute(query, (
                profile.user_id,
                json.dumps(profile.goals),
                profile.workouts_per_week,
                json.dumps(profile.ai_extracted_data),
                profile.fitness_score,
                profile.weight_kg,
                profile.height_cm,
                profile.age,
                profile.resting_bpm,
                profile.experience_level,
                profile.broad_goal
            ))
            conn.commit()
        finally:
            cur.close()
            conn.close()
            
        return {"status": "complete", "data": profile.dict()}

    except Exception as e:
        print(f"ERROR: {str(e)}")
        import traceback
        traceback.print_exc()
        return {"status": "error", "message": f"Server Error: {str(e)}"}

# --- JOURNALING ENDPOINT ---

@app.post("/journal")
async def process_journal(user_id: str, entry_text: str):
    raw_response = journal_model.generate_content(f"{JOURNAL_INPUT_PROMPT}\n\nEntry: {entry_text}")
    json_match = re.search(r'\{.*\}', raw_response.text, re.DOTALL)
    
    if not json_match: raise HTTPException(status_code=500, detail="Parsing Error")
    cleaned_data = json.loads(json_match.group())

    conn = connect(**SNOWFLAKE_CONFIG)
    cur = conn.cursor()
    try:
        # First, get sentiment score
        cur.execute("SELECT SNOWFLAKE.CORTEX.SENTIMENT(%s)", (cleaned_data["cleaned_text"],))
        sentiment_score = cur.fetchone()[0]
        
        # Insert journal entry
        cur.execute(
            "INSERT INTO USER_JOURNALS (USER_ID, JOURNAL, SENTIMENT_ANALYSIS, CREATED_AT) VALUES (%s, %s, %s, CURRENT_TIMESTAMP())",
            (user_id, cleaned_data["cleaned_text"], sentiment_score)
        )
        conn.commit()

        # Get user goals
        cur.execute("SELECT GOALS FROM USER_PROFILES WHERE USER_ID = %s", (user_id,))
        row = cur.fetchone()
        user_interests = row[0] if row else "General fitness"

        final_prompt = JOURNAL_OUTPUT_PROMPT.format(
            cleaned_text=cleaned_data["cleaned_text"],
            cortex_score=sentiment_score,
            user_goals_and_activities=user_interests
        )
        analysis_response = journal_model.generate_content(final_prompt)
        conn.commit()
        
        return {
            "score": sentiment_score,
            "observation": analysis_response.text,
            "tags": cleaned_data["context_tags"],
            "safety_flag": cleaned_data["safety_flag"]
        }
    finally:
        cur.close()
        conn.close()

# --- SCHEDULE GENERATION ENDPOINT ---

@app.post("/generate-schedule")
async def generate_schedule(user_id: str):
    conn = connect(**SNOWFLAKE_CONFIG)
    cur = conn.cursor()
    try:
        cur.execute("SELECT BROAD_GOAL, FITNESS_SCORE, AI_EXTRACTED_DATA FROM USER_PROFILES WHERE USER_ID = %s", (user_id,))
        row = cur.fetchone()
        if not row: raise HTTPException(status_code=404, detail="Not Found")
            
        broad_goal, fitness_score, extracted_data = row
        availability = extracted_data.get('schedule', '3 days a week')

        prompt = SCHEDULE_GENERATOR_PROMPT.format(
            fitness_score=fitness_score,
            broad_goal=broad_goal,
            availability=availability
        )
        
        response = journal_model.generate_content(prompt)
        json_match = re.search(r'\[.*\]', response.text, re.DOTALL)
        
        if json_match:
            return {"user_id": user_id, "weekly_plan": json.loads(json_match.group())}
        
        return {"error": "Invalid AI JSON"}
    finally:
        cur.close()
        conn.close()

@app.get("/health")
async def health_check():
    return {"status": "alive"}

@app.get("/profile/{user_id}")
async def get_user_profile(user_id: str):
    conn = connect(**SNOWFLAKE_CONFIG)
    cur = conn.cursor()
    
    try:
        # Calculate BMI and Max BPM directly in SQL for efficiency
        query = """
        SELECT 
            USER_ID, 
            AGE, 
            HEIGHT_CM, 
            WEIGHT_KG, 
            RESTING_BPM,
            -- BMI Formula: kg / (m^2)
            ROUND(WEIGHT_KG / SQUARE(HEIGHT_CM / 100), 1) as BMI,
            -- Max BPM Formula: 220 - Age
            (220 - AGE) as MAX_BPM
        FROM USER_PROFILES 
        WHERE USER_ID = %s
        """
        cur.execute(query, (user_id,))
        row = cur.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="User profile not found")
            
        return {
            "user_id": row[0],
            "age": row[1],
            "height_cm": row[2],
            "weight_kg": row[3],
            "resting_bpm": row[4],
            "bmi": row[5],
            "max_bpm": row[6]
        }
    finally:
        cur.close()
        conn.close()