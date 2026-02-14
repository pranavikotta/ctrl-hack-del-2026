import os
from fastapi import FastAPI, HTTPException
from dotenv import load_dotenv
from snowflake.sqlalchemy import URL
from sqlalchemy import create_engine, text

# Load environment variables from .env
load_dotenv()

app = FastAPI()

def get_snowflake_conn():
    # Construct the connection URL
    # IMPORTANT: Ensure SNOWFLAKE_ACCOUNT in .env does NOT include 'snowflakecomputing.com'
    url = URL(
        account=os.getenv("SNOWFLAKE_ACCOUNT"),
        user=os.getenv("SNOWFLAKE_USER"),
        password=os.getenv("SNOWFLAKE_PASSWORD"),
        database=os.getenv("SNOWFLAKE_DATABASE"),
        schema=os.getenv("SNOWFLAKE_SCHEMA"),
        warehouse=os.getenv("SNOWFLAKE_WAREHOUSE"),
        role=os.getenv("SNOWFLAKE_ROLE"),
    )
    # Using echo=True will log all SQL commands to your terminal (great for debugging)
    engine = create_engine(url, echo=True)
    return engine

@app.get("/")
async def root():
    return {"message": "Server is alive!"}

@app.get("/test-snowflake")
async def test_snowflake():
    try:
        engine = get_snowflake_conn()
        with engine.connect() as connection:
            # Test 1: Check Snowflake Version
            version_result = connection.execute(text("SELECT CURRENT_VERSION()")).fetchone()
            
            # Test 2: Verify our table exists and we can see it
            table_check = connection.execute(text("SHOW TABLES LIKE 'USER_PROFILES'")).fetchone()
            
            return {
                "status": "Connected Successfully!",
                "snowflake_version": version_result[0],
                "database": os.getenv("SNOWFLAKE_DATABASE"),
                "table_found": True if table_check else False
            }
    except Exception as e:
        # If this fails, check your .env credentials or Network Policy in Snowflake
        raise HTTPException(status_code=500, detail=str(e))