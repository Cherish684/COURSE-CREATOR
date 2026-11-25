import os
import json

from groq import Groq
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Create Groq client
client = Groq(
    api_key=os.getenv("GROQ_API_KEY")
)

SYSTEM_PROMPT = """
You are a feedback analysis assistant.

Return ONLY valid JSON in this format:

{
  "sentiment": "Positive | Negative | Neutral",
  "confidence": 0-100,
  "reason": "short explanation"
}
"""


def analyze_feedback(text: str):
    try:
        response = client.chat.completions.create(
            model="llama-3.3-70b-versatile",
            messages=[
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": text
                }
            ],
            temperature=0.2,
            max_tokens=150
        )

        content = response.choices[0].message.content

        print("RAW OUTPUT:")
        print(content)

        result = json.loads(content)

        return result

    except json.JSONDecodeError:
        return {
            "sentiment": "Neutral",
            "confidence": 50,
            "reason": "Model did not return valid JSON"
        }

    except Exception as e:
        return {
            "sentiment": "Neutral",
            "confidence": 50,
            "reason": str(e)
        }


if __name__ == "__main__":

    feedback = "The course was amazing and very easy to understand"

    result = analyze_feedback(feedback)

    print(result)