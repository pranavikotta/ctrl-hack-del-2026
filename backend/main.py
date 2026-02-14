import os
import re
import json
from typing import List, Dict
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware # <--- IMPORT THIS
from dotenv import load_dotenv
import google.generativeai as genai
from snowflake.connector import connect

# Import your models and prompts
from data_structure import UserProfile, UserJournal
from system_prompts import ONBOARD_PROMPT, JOURNAL_INPUT_PROMPT, JOURNAL_OUTPUT_PROMPT

# 1. Load Environment Variables
load_dotenv()

app = FastAPI()
origins = [
    "http://localhost:5173",  # React default port
    "http://127.0.0.1:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
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

# --- DUAL MODEL INITIALIZATION ---

onboard_model = genai.GenerativeModel(
    model_name='gemini-2.5-flash',
    system_instruction=ONBOARD_PROMPT,
    generation_config={"temperature": 0.1}
)

journal_model = genai.GenerativeModel(
    model_name='gemini-2.5-flash',
    generation_config={"temperature": 0.7}
)

# --- ONBOARDING ENDPOINT ---

@app.post("/onboard")
async def onboard_user(chat_history: List[Dict[str, str]]):
    formatted_messages = []
    for msg in chat_history:
        role = "user" if msg["role"] == "user" else "model"
        formatted_messages.append({"role": role, "parts": [msg["content"]]})

    if not formatted_messages or formatted_messages[-1]["role"] != "user":
        return {"status": "chatting", "message": "Waiting for your input..."}

    try:
        response = onboard_model.generate_content(formatted_messages)
        response_text = response.text

        print("\n" + "="*50)
        print(f"DEBUG: Gemini's Raw Response:\n{response_text}")
        print("="*50 + "\n")

        json_match = re.search(r'\{.*\}', response_text, re.DOTALL)
        
        if json_match:
            raw_json = json.loads(json_match.group())
            
            # --- TODO: CALL YOUR SEPARATE FITNESS MODEL HERE ---
            # score, cals = my_separate_model.predict(raw_json['workouts_per_week'], raw_json['goals'])
            # raw_json["fitness_score"] = score
            # raw_json["target_calories"] = cals
            
            # For now, we set defaults so the Pydantic model doesn't fail
            raw_json.setdefault("fitness_score", 0.0)
            raw_json.setdefault("target_calories", 2000)
            
            profile = UserProfile(**raw_json)
            
            conn = connect(**SNOWFLAKE_CONFIG)
            cur = conn.cursor()
            try:
                query = """
                INSERT INTO USER_PROFILES (
                    USER_ID, GOALS, WORKOUTS_PER_WEEK, 
                    AI_EXTRACTED_DATA, FITNESS_SCORE, TARGET_CALORIES,
                    BROAD_GOAL, WEIGHT_KG, HEIGHT_CM, AGE, RESTING_BPM, EXPERIENCE_LEVEL,
                    CREATED_AT
                )
                SELECT %s, PARSE_JSON(%s), %s, PARSE_JSON(%s), %s, %s, %s, %s, %s, %s, %s, %s, CURRENT_TIMESTAMP()
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
            "INSERT INTO USER_JOURNALS (USER_ID, JOURNAL, CREATED_AT) VALUES (%s, %s, CURRENT_TIMESTAMP())",
            (user_id, cleaned_data["cleaned_text"])
        )
        
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