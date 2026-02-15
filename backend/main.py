import os
import re
import json
import uuid
import joblib
import numpy as np
from typing import List, Dict, Any, Optional
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from snowflake.connector import connect

# Import your models and prompts
from data_structure import UserProfile, UserJournal
from system_prompts import (
    ONBOARD_PROMPT,
    JOURNAL_INPUT_PROMPT,
    JOURNAL_OUTPUT_PROMPT,
    SCHEDULE_GENERATOR_PROMPT,
)

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

SNOWFLAKE_CONFIG = {
    "user":      os.getenv("SNOWFLAKE_USER"),
    "password":  os.getenv("SNOWFLAKE_PASSWORD"),
    "account":   os.getenv("SNOWFLAKE_ACCOUNT"),
    "warehouse": os.getenv("SNOWFLAKE_WAREHOUSE"),
    "database":  os.getenv("SNOWFLAKE_DATABASE"),
    "schema":    os.getenv("SNOWFLAKE_SCHEMA"),
}

CORTEX_MODEL = "gemini-2.5-flash" 

fit_model  = joblib.load("fitness_model.pkl")
fit_scaler = joblib.load("scaler.pkl")

def _get_conn():
    return connect(**SNOWFLAKE_CONFIG)

def cortex_complete(prompt: str, system: str = "", temperature: float = 0.3) -> str:
    conn = _get_conn()
    cur  = conn.cursor()
    try:
        if system:
            messages = json.dumps([
                {"role": "system", "content": system},
                {"role": "user",   "content": prompt},
            ])
            options = json.dumps({"temperature": temperature})
            cur.execute(
                "SELECT SNOWFLAKE.CORTEX.COMPLETE(%s, PARSE_JSON(%s), PARSE_JSON(%s))",
                (CORTEX_MODEL, messages, options),
            )
        else:
            cur.execute(
                "SELECT SNOWFLAKE.CORTEX.COMPLETE(%s, %s)",
                (CORTEX_MODEL, prompt),
            )
        
        result = cur.fetchone()[0]
        if isinstance(result, str):
            try:
                parsed = json.loads(result)
                if "choices" in parsed:
                    return parsed["choices"][0]["messages"].strip()
                return result.strip()
            except Exception:
                return result.strip()
        return str(result).strip()
    finally:
        cur.close()
        conn.close()

def cortex_complete_chat(history: List[Dict[str, str]], system: str = "") -> str:
    messages = []
    if system:
        messages.append({"role": "system", "content": system})
    for msg in history:
        role = "user" if msg["role"] == "user" else "assistant"
        messages.append({"role": role, "content": msg["content"]})

    conn = _get_conn()
    cur  = conn.cursor()
    try:
        options = json.dumps({"temperature": 0.1})
        cur.execute(
            "SELECT SNOWFLAKE.CORTEX.COMPLETE(%s, PARSE_JSON(%s), PARSE_JSON(%s))",
            (CORTEX_MODEL, json.dumps(messages), options),
        )
        result = cur.fetchone()[0]
        if isinstance(result, str):
            try:
                parsed = json.loads(result)
                if "choices" in parsed:
                    return parsed["choices"][0]["messages"].strip()
                return result.strip()
            except Exception:
                return result.strip()
        return str(result).strip()
    finally:
        cur.close()
        conn.close()

@app.post("/onboard")
async def onboard_user(data: List[Dict[str, str]]):
    try:
        response_text = cortex_complete_chat(data, system=ONBOARD_PROMPT)
        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        if json_match:
            raw_json = json.loads(json_match.group())
            return {
                "status": "needs_metrics",
                "partial_data": raw_json,
                "message": "Great! Now let's grab a few measurements.",
            }
        return {"status": "chatting", "message": response_text}
    except Exception as e:
        return {"status": "error", "message": f"Server Error: {str(e)}"}

@app.post("/complete_profile")
async def complete_profile(profile_data: dict):
    try:
        # ALWAYS generate a new unique user_id, don't trust frontend
        user_id = "user_" + uuid.uuid4().hex[:8]
        profile_data["user_id"] = user_id
        
        print(f"[DEBUG] Creating profile with user_id: {user_id}")

        age = float(profile_data.get("age", 0))
        weight = float(profile_data.get("weight_kg", 0))
        height_cm = float(profile_data.get("height_cm", 0))
        resting_bpm = float(profile_data.get("resting_bpm", 0))
        workout_freq = float(profile_data.get("workouts_per_week", 0))

        height_m = height_cm / 100
        bmi = weight / (height_m ** 2) if height_m > 0 else 0
        max_bpm = 220 - age

        feats = np.array([[age, weight, height_m, resting_bpm, max_bpm, workout_freq, bmi]])
        scaled = fit_scaler.transform(feats)
        fitness_proba = fit_model.predict_proba(scaled)[0][1]
        exp_level = int(fit_model.predict(scaled)[0]) + 1

        profile_data["fitness_score"] = round(float(fitness_proba), 2)
        profile_data["experience_level"] = exp_level

        profile = UserProfile(**profile_data)
        
        conn = _get_conn()
        cur = conn.cursor()
        try:
            query = """
            INSERT INTO USER_PROFILES (
                USER_ID, GOALS, WORKOUTS_PER_WEEK, AI_EXTRACTED_DATA,
                FITNESS_SCORE, WEIGHT_KG, HEIGHT_CM, AGE,
                RESTING_BPM, EXPERIENCE_LEVEL, CREATED_AT, BROAD_GOAL
            ) 
            SELECT 
                %s, TRY_PARSE_JSON(%s), %s, TRY_PARSE_JSON(%s), 
                %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP(), %s
            """
            cur.execute(query, profile.to_snowflake_query())
            conn.commit()
            print(f"[DEBUG] Profile saved successfully for {user_id}")
        finally:
            cur.close()
            conn.close()

        return {"status": "complete", "data": profile.dict()}
    except Exception as e:
        print(f"[ERROR] Profile creation failed: {str(e)}")
        return {"status": "error", "message": f"Server Error: {str(e)}"}

@app.post("/journal")
async def process_journal(user_id: str, entry_text: str):
    conn = _get_conn()
    cur = conn.cursor()
    try:
        clean_prompt = f"{JOURNAL_INPUT_PROMPT}\n\nEntry: {entry_text}"
        clean_response = cortex_complete(clean_prompt, temperature=0.2)
        json_match = re.search(r'\{.*\}', clean_response, re.DOTALL)
        
        if not json_match:
            raise HTTPException(status_code=500, detail="Journal parsing error")
        cleaned_data = json.loads(json_match.group())

        cur.execute("SELECT SNOWFLAKE.CORTEX.SENTIMENT(%s)", (cleaned_data["cleaned_text"],))
        sentiment_score = cur.fetchone()[0]

        cur.execute(
            "INSERT INTO USER_JOURNALS (USER_ID, JOURNAL, SENTIMENT_ANALYSIS, CREATED_AT) VALUES (%s, %s, %s, CURRENT_TIMESTAMP())",
            (user_id, cleaned_data["cleaned_text"], sentiment_score),
        )
        conn.commit()

        cur.execute("SELECT GOALS FROM USER_PROFILES WHERE USER_ID = %s", (user_id,))
        row = cur.fetchone()
        user_interests = str(row[0]) if row else "General fitness"

        obs_prompt = JOURNAL_OUTPUT_PROMPT.format(
            cleaned_text=cleaned_data["cleaned_text"],
            cortex_score=sentiment_score,
            user_goals_and_activities=user_interests,
        )
        observation = cortex_complete(obs_prompt, temperature=0.5)

        return {
            "score": sentiment_score,
            "observation": observation,
            "tags": cleaned_data["context_tags"],
            "safety_flag": cleaned_data["safety_flag"],
        }
    finally:
        cur.close()
        conn.close()

# --- ADDED ENDPOINTS FOR DASHBOARD ---

@app.get("/journal_history/{user_id}")
async def get_journal_history(user_id: str):
    conn = _get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT TO_CHAR(CREATED_AT, 'Dy') as day, 
                   CAST(SENTIMENT_ANALYSIS AS FLOAT) as sentiment
            FROM USER_JOURNALS 
            WHERE USER_ID = %s 
            ORDER BY CREATED_AT DESC LIMIT 7
        """, (user_id,))
        rows = cur.fetchall()
        # Convert to format React Chart expects
        history = [{"day": r[0], "sentiment": r[1]} for r in rows]
        return {"history": list(reversed(history))}
    finally:
        cur.close()
        conn.close()

@app.get("/workout_stats/{user_id}")
async def get_workout_stats(user_id: str):
    conn = _get_conn()
    cur = conn.cursor()
    try:
        cur.execute("SELECT WORKOUTS_PER_WEEK FROM USER_PROFILES WHERE USER_ID = %s", (user_id,))
        row = cur.fetchone()
        goal = row[0] if row else 0
        
        # TODO: In a real app, track actual completed workouts from a WORKOUTS table
        # For now, return 0 completed with calculated fields
        completed = 0
        percentage = 0 if goal == 0 else int((completed / goal) * 100)
        remaining = max(0, goal - completed)
        
        return {
            "completed": completed,
            "goal": goal,
            "percentage": percentage,
            "remaining": remaining
        }
    finally:
        cur.close()
        conn.close()

@app.get("/profile/{user_id}")
async def get_profile(user_id: str):
    conn = _get_conn()
    cur = conn.cursor()
    try:
        cur.execute("""
            SELECT AGE, HEIGHT_CM, WEIGHT_KG, RESTING_BPM, FITNESS_SCORE, BROAD_GOAL
            FROM USER_PROFILES WHERE USER_ID = %s
        """, (user_id,))
        r = cur.fetchone()
        
        if not r:
            return {"error": "Not found"}

        # Calculate BMI from the data
        age = r[0]
        height_cm = r[1]
        weight_kg = r[2]
        resting_bpm = r[3]
        fitness_score = r[4]
        broad_goal = r[5]
        
        height_m = height_cm / 100
        bmi = round(weight_kg / (height_m ** 2), 1) if height_m > 0 else 0

        # Construct the response to match the 'profileData' state in React
        return {
            "user_id": user_id,
            "age": age,
            "height_cm": height_cm,
            "weight_kg": weight_kg,
            "resting_bpm": resting_bpm,
            "fitness_score": fitness_score,
            "broad_goal": broad_goal,
            "bmi": bmi  # Add calculated BMI
        }
    finally:
        cur.close()
        conn.close()

@app.patch("/profile/{user_id}")
async def update_profile(user_id: str, updates: dict):
    """Update user profile metrics and recalculate fitness score"""
    conn = _get_conn()
    cur = conn.cursor()
    try:
        # Extract the new values
        age = float(updates.get("age"))
        weight = float(updates.get("weight_kg"))
        height_cm = float(updates.get("height_cm"))
        resting_bpm = float(updates.get("resting_bpm"))
        
        # Recalculate fitness score
        height_m = height_cm / 100
        bmi = weight / (height_m ** 2) if height_m > 0 else 0
        max_bpm = 220 - age
        
        # Get workouts_per_week from existing profile
        cur.execute("SELECT WORKOUTS_PER_WEEK FROM USER_PROFILES WHERE USER_ID = %s", (user_id,))
        row = cur.fetchone()
        workout_freq = float(row[0]) if row else 3.0
        
        # Recalculate fitness score using model
        feats = np.array([[age, weight, height_m, resting_bpm, max_bpm, workout_freq, bmi]])
        scaled = fit_scaler.transform(feats)
        fitness_proba = fit_model.predict_proba(scaled)[0][1]
        exp_level = int(fit_model.predict(scaled)[0]) + 1
        
        fitness_score = round(float(fitness_proba), 2)
        
        # Update the database
        cur.execute("""
            UPDATE USER_PROFILES 
            SET AGE = %s, 
                HEIGHT_CM = %s, 
                WEIGHT_KG = %s, 
                RESTING_BPM = %s,
                FITNESS_SCORE = %s,
                EXPERIENCE_LEVEL = %s
            WHERE USER_ID = %s
        """, (age, height_cm, weight, resting_bpm, fitness_score, exp_level, user_id))
        conn.commit()
        
        return {
            "status": "updated",
            "user_id": user_id,
            "age": age,
            "height_cm": height_cm,
            "weight_kg": weight,
            "resting_bpm": resting_bpm,
            "fitness_score": fitness_score,
            "experience_level": exp_level
        }
    except Exception as e:
        return {"status": "error", "message": str(e)}
    finally:
        cur.close()
        conn.close()

@app.get("/health")
async def health_check():
    return {"status": "alive", "engine": f"Snowflake Cortex ({CORTEX_MODEL})"}