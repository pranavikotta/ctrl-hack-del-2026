#kaggle exercise training set is used for fitness score calculation via logistic regression
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score
import pandas as pd
import joblib

#read csv
data = pd.read_csv('gym_members_exercise_tracking.csv')

#drop irrelevant columns, only retaining age, height, weight, bmi, resting_bpm, max_heart_rate
features = ['Age', 'Weight (kg)', 'Height (m)', 'Resting_BPM', 'Max_BPM', 'Workout_Frequency (days/week)', 'BMI']

#target variable - experience level
y = (data['Experience_Level'] == 3).astype(int) #3 for expert, 2 for intermediate, 1 for beginner
X = data[features]

X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42)

scaler = StandardScaler()
X_train_scaled = scaler.fit_transform(X_train)
X_test_scaled = scaler.transform(X_test)

model = LogisticRegression()
model.fit(X_train_scaled, y_train)

#evaluation
y_pred = model.predict(X_test_scaled)
y_prob = model.predict_proba(X_test_scaled)[:, 1]

print(f"Accuracy: {accuracy_score(y_test, y_pred):.2f}")

#save pickle files
joblib.dump(model, 'fitness_model.pkl')
joblib.dump(scaler, 'scaler.pkl')
print("Model and Scaler saved.")