Cadence AI
Winner: Best Use of Snowflake API at Ctrl+Hack+Del 2.0 (MLH)

Cadence AI is a health-tech platform designed to bridge the gap between physical biometric tracking and psychological adherence. While traditional fitness tools excel at logging physiological metrics, Cadence AI extends these capabilities by utilizing a multi-AI pipeline to identify mental burnout and predict user capability through machine learning.

🧠 The Philosophy: Reengineering Motivation
Biometric tracking is a solved problem. The real barrier to health is the Motivation Gap. We built Cadence AI as a "collaborator" rather than a spreadsheet, focusing on:
Predictive Capability: Moving beyond generic estimates to data-driven fitness scoring.
Mental Recovery: Identifying declining sentiment in workout reflections to prevent physical injury.
Dynamic Adherence: Creating a schedule that adapts to the user’s life in real-time.

🛠️ Technical Architecture
1. Predictive ML Engine (Scikit-Learn)
To provide a foundation for personalized training, we implemented a Logistic Regression model trained on a Kaggle dataset of 900+ gym members.
Input: Clinical biomarkers (BMI, Resting Heart Rate, Age, etc.).
Output: A "Fitness Experience Score" used to calibrate the intensity of AI-generated workout plans.

2. Conversational Intelligence (Gemini 2.5 Flash)
We utilized Gemini 2.5 Flash to lead a natural-language onboarding process. This serves as a digital coach that extracts structured fitness objectives, preferred training modalities, and scheduling constraints from unstructured user dialogue.

3. Mental Recovery Analysis (Snowflake Cortex AI)
By leveraging Snowflake Cortex AI, the system performs high-speed sentiment analysis on post-workout journal entries.
Burnout Prevention: The system identifies declining mental recovery trends.
Actionable Feedback: If potential burnout is detected, the AI suggests corrective methods (e.g., active recovery or intensity adjustments) before physical injury occurs.

4. Unified Data Infrastructure (Snowflake)
All user profiles, ML-predicted scores, and longitudinal sentiment data are centralized in a SQL Snowflake data warehouse, ensuring high performance, security, and a single source of truth for the user’s health record.

💻 Frontend & Design
The user interface was built with React and Vite, focusing on a minimalist, "Apple-style" aesthetic to reduce cognitive load.
Glassmorphism UI: Soft visual hierarchy to move away from the stress of traditional "stat-heavy" dashboards.
Dynamic Calendar: A custom-built, editable schedule featuring sticky indicators. The calendar remains fully interactive even after the AI initializes the schedule timing.

🚀 Tech Stack
Frontend: React, Vite, HTML, CSS
Backend: Python, FastAPI
Machine Learning: Scikit-learn, Pandas
AI/LLM: Gemini 2.5 Flash, Snowflake Cortex AI
Database: Snowflake (SQL)

👥 The Team
Developed in 48 hours for Ctrl+Hack+Del 2.0 by: Jana Hamidaldeen & Pranavi Kotta
