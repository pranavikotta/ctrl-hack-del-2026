from pydantic import BaseModel, Field
from typing import List, Dict, Any
from datetime import datetime
import json

class UserProfile(BaseModel):
    user_id: str
    broad_goal: str  # from the buttons (weight loss, strength, etc.)
    goals: List[str]  # extracted by gemini (i.e. marathon)
    workouts_per_week: int
    weight_kg: float
    height_cm: float
    age: int
    resting_bpm: int
    experience_level: int
    ai_extracted_data: Dict[str, Any]
    fitness_score: float = 0.0
    
    def to_snowflake_query(self):
        return (
            self.user_id,             # %s 1
            json.dumps(self.goals),   # %s 2
            self.workouts_per_week,   # %s 3
            json.dumps(self.ai_extracted_data), # %s 4
            self.fitness_score,       # %s 5
            self.weight_kg,           # %s 6
            self.height_cm,           # %s 7
            self.age,                 # %s 8
            self.resting_bpm,         # %s 9
            self.experience_level,    # %s 10
            self.broad_goal           # %s 11
        )

class UserJournal(BaseModel):
    user_id: str
    journal_id: str = Field(default_factory=lambda: "jrnl_" + datetime.now().strftime("%Y%m%d%H%M%S"))
    text: str = Field(..., min_length=1)
    cleaned_text: str 
    context_tags: List[str] = Field(default_factory=list)
    safety_flag: bool = False
    # Simplified: One dict for all analysis (Cortex Score + Gemini Recommendations)
    analysis_results: Dict[str, Any] = Field(default_factory=dict) 
    created_at: datetime = Field(default_factory=datetime.utcnow)
    
    def to_snowflake_query(self):
        # Update the tuple to include ALL fields you have in Snowflake
        return (
            self.journal_id,
            self.user_id,
            self.text,
            self.cleaned_text,
            json.dumps(self.context_tags),
            self.safety_flag,
            json.dumps(self.analysis_results),
            self.created_at
        )