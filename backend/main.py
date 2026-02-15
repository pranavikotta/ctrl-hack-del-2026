import os
import re
import json
import joblib
import numpy as np
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware # <--- IMPORT THIS
from pydantic import BaseModel
from dotenv import load_dotenv
import google.generativeai as genai
from snowflake.connector import connect

# Import your models and prompts
from data_structure import UserProfile, UserJournal
from system_prompts import ONBOARD_PROMPT, JOURNAL_INPUT_PROMPT, JOURNAL_OUTPUT_PROMPT

# 1. Load Environment Variables
load_dotenv()

app = FastAPI()

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
async def onboard_user(request: OnboardRequest):
    chat_history = request.chat_history
    user_stats = request.user_stats
    
    # 1. Context Injection
    if len(chat_history) == 1 and user_stats:
        context_prefix = (
            f"[SYSTEM CONTEXT: Goal: {user_stats.get('broad_goal')}. "
            f"Stats: {user_stats.get('weight_kg')}kg, {user_stats.get('age')}y, "
            f"BPM: {user_stats.get('resting_bpm')}, Freq: {user_stats.get('workouts_per_week')} sessions/wk. "
            f"Acknowledge this and ask about injuries and specific history.]\n\n"
        )
        chat_history[0]["content"] = context_prefix + chat_history[0]["content"]

    formatted_messages = []
    for msg in chat_history:
        role = "user" if msg["role"] == "user" else "model"
        formatted_messages.append({"role": role, "parts": [msg["content"]]})

    if not formatted_messages or formatted_messages[-1]["role"] != "user":
        return {"status": "chatting", "message": "Waiting for your input..."}

    try:
        response = onboard_model.generate_content(formatted_messages)
        response_text = response.text
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        
        if json_match:
            raw_json = json.loads(json_match.group())
            
            # Merge button stats from frontend
            if user_stats:
                raw_json.update(user_stats)
            
            # 2. ML INFERENCE (Calculating the Score)
            try:
                age = float(raw_json.get("age", 0))
                weight = float(raw_json.get("weight_kg", 0))
                height_cm = float(raw_json.get("height_cm", 0))
                resting_bpm = float(raw_json.get("resting_bpm", 0))
                workout_freq = float(raw_json.get("workouts_per_week", 0))
                
                # Feature Engineering
                height_m = height_cm / 100
                bmi = weight / (height_m ** 2) if height_m > 0 else 0
                max_bpm = 220 - age
                
                # 3. Arrange features (ORDER MUST MATCH TRAINING SCRIPT)
                # ['Age', 'Weight (kg)', 'Height (m)', 'Resting_BPM', 'Max_BPM', 'Workout_Frequency', 'BMI']
                input_features = np.array([[age, weight, height_m, resting_bpm, max_bpm, workout_freq, bmi]])
                
                # 4. Scale and Predict Probability
                scaled_input = fit_scaler.transform(input_features)
                # predict_proba returns [prob_class_0, prob_class_1]
                fitness_score = fit_model.predict_proba(scaled_input)[0][1] 
                
                raw_json["fitness_score"] = round(float(fitness_score), 2)
                
            except Exception as e:
                print(f"Inference Error: {e}")
                raw_json["fitness_score"] = 0.0

            # 5. Save to Snowflake
            profile = UserProfile(**raw_json)
            conn = connect(**SNOWFLAKE_CONFIG)
            cur = conn.cursor()
            try:
                query = """
                INSERT INTO USER_PROFILES (
                    USER_ID, GOALS, WORKOUTS_PER_WEEK, AI_EXTRACTED_DATA, 
                    FITNESS_SCORE, BROAD_GOAL, WEIGHT_KG, HEIGHT_CM, AGE, 
                    RESTING_BPM, EXPERIENCE_LEVEL, CREATED_AT
                )
                SELECT %s, PARSE_JSON(%s), %s, PARSE_JSON(%s), %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP()
                """
                cur.execute(query, profile.to_snowflake_query())
                conn.commit()
            finally:
                cur.close()
                conn.close()
                
            return {"status": "complete", "data": profile}

        return {"status": "chatting", "message": response_text}

    except Exception as e:
        print(f"ERROR: {str(e)}")
        return {"status": "error", "message": f"Server Error: {str(e)}"}

# --- JOURNALING ENDPOINT ---

@app.post("/journal")
async def process_journal(user_id: str, entry_text: str):
    raw_response = journal_model.generate_content(f"{JOURNAL_INPUT_PROMPT}\n\nUser Entry: {entry_text}")
    json_match = re.search(r'\{.*\}', raw_response.text, re.DOTALL)
    
    if not json_match:
        raise HTTPException(status_code=500, detail="AI failed to structure entry")
    
    cleaned_data = json.loads(json_match.group())

    conn = connect(**SNOWFLAKE_CONFIG)
    cur = conn.cursor()
    
    try:
        cur.execute(
        "INSERT INTO USER_JOURNALS (USER_ID, JOURNAL, SENTIMENT_ANALYSIS, CREATED_AT) VALUES (%s, %s, %s, CURRENT_TIMESTAMP())",
        (user_id, cleaned_data["cleaned_text"], sentiment_score))
        
        cur.execute("SELECT SNOWFLAKE.CORTEX.SENTIMENT(%s)", (cleaned_data["cleaned_text"],))
        sentiment_score = cur.fetchone()[0]

        cur.execute("SELECT GOALS FROM USER_PROFILES WHERE USER_ID = %s", (user_id,))
        row = cur.fetchone()
        user_interests = row[0] if row else "General wellness"

        final_prompt = JOURNAL_OUTPUT_PROMPT.format(
            cleaned_text=cleaned_data["cleaned_text"],
            cortex_score=sentiment_score,
            user_goals_and_activities=user_interests
        )
        
        analysis_response = journal_model.generate_content(final_prompt)
        
        return {
            "score": sentiment_score,
            "observation": analysis_response.text,
            "tags": cleaned_data["context_tags"],
            "safety_flag": cleaned_data["safety_flag"]
        }
    finally:
        cur.close()
        conn.close()

# --- CONNECTION TEST ENDPOINT ---

@app.get("/health")
async def health_check():
    try:
        conn = connect(**SNOWFLAKE_CONFIG)
        conn.close()
        return {"status": "healthy", "database": "connected"}
    except Exception as e:
        return {"status": "unhealthy", "error": str(e)}
    

# --- SCHEDULE GENERATION ENDPOINT ---
@app.post("/generate-schedule")
async def generate_schedule(user_id: str):
    conn = connect(**SNOWFLAKE_CONFIG)
    cur = conn.cursor()
    try:
        # 1. Fetch the data your ML model and Gemini previously saved
        cur.execute("""
            SELECT BROAD_GOAL, FITNESS_SCORE, AI_EXTRACTED_DATA 
            FROM USER_PROFILES WHERE USER_ID = %s
        """, (user_id,))
        row = cur.fetchone()
        
        if not row:
            raise HTTPException(status_code=404, detail="User not found")
            
        broad_goal, fitness_score, extracted_data = row
        availability = extracted_data.get('schedule', 'General availability')

        # 2. Feed it into the new Prompt
        final_prompt = SCHEDULE_GENERATOR_PROMPT.format(
            fitness_score=fitness_score,
            broad_goal=broad_goal,
            availability=availability
        )
        
        # 3. Get the structured JSON from Gemini
        response = journal_model.generate_content(final_prompt)
        
        # 4. Extract just the JSON list
        json_match = re.search(r'\[.*\]', response.text, re.DOTALL)
        if json_match:
            structured_plan = json.loads(json_match.group())
            return {"user_id": user_id, "weekly_plan": structured_plan}
        
        return {"error": "AI failed to generate a valid JSON schedule"}
        
    finally:
        cur.close()
        conn.close()