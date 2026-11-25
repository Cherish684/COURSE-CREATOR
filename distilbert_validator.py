import os

MODEL_PATH = 'distilbert_quiz_model'
LABEL_MAP = {0: 'easy', 1: 'medium', 2: 'hard'}
REVERSE_MAP = {'easy': 0, 'medium': 1, 'hard': 2}

_model = None
_tokenizer = None
_model_available = False

def load_distilbert():
    global _model, _tokenizer, _model_available
    if _model_available:
        return True
    if not os.path.exists(MODEL_PATH):
        print("[DistilBERT] Model not found — using Groq fallback for difficulty")
        return False
    try:
        from transformers import DistilBertTokenizerFast, DistilBertForSequenceClassification
        import torch
        _tokenizer = DistilBertTokenizerFast.from_pretrained(MODEL_PATH)
        _model = DistilBertForSequenceClassification.from_pretrained(MODEL_PATH)
        _model.eval()
        _model_available = True
        print("[DistilBERT] Model loaded successfully")
        return True
    except Exception as e:
        print(f"[DistilBERT] Failed to load: {e}")
        return False

def predict_difficulty(question_text):
    if not _model_available:
        if not load_distilbert():
            return None
    try:
        import torch
        inputs = _tokenizer(question_text, return_tensors='pt', truncation=True, max_length=128, padding=True)
        with torch.no_grad():
            outputs = _model(**inputs)
        predicted_class = outputs.logits.argmax(dim=1).item()
        return LABEL_MAP[predicted_class]
    except Exception as e:
        print(f"[DistilBERT] Prediction error: {e}")
        return None

def validate_question_difficulty(question_text, requested_difficulty):
    predicted = predict_difficulty(question_text)
    if predicted is None:
        return True, None
    matches = predicted.lower() == requested_difficulty.lower()
    return matches, predicted

load_distilbert()