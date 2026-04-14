import requests
import json
API_KEY = "AIzaSyDhw1fknqP1-cYru1iZZDob2_poEU10pK8"
url = f"https://generativelanguage.googleapis.com/v1beta/models?key={API_KEY}"
resp = requests.get(url)
with open("scratch/models_list.json", "w") as f:
    json.dump(resp.json(), f, indent=2)
print("Saved models to scratch/models_list.json")
