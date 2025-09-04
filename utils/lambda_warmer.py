import os
import urllib3
import json

API_ENDPOINT = os.environ.get('API_ENDPOINT')
API_KEY = os.environ.get('API_KEY')

http = urllib3.PoolManager()

def lambda_handler(event, context):
    """
    Lambda warmer for preventing cold start.
    """
    if not API_ENDPOINT:
        print("Error: API_ENDPOINT environment variable is not set.")
        return {"statusCode": 200, "body": json.dumps("Warmer finished. Configuration error noted in logs.")}

    headers = {}
    if API_KEY:
        headers['x-api-key'] = API_KEY

    try:
        resp = http.request('GET', API_ENDPOINT, headers=headers)
        print(f"Warmer ping sent to {API_ENDPOINT}. Status: {resp.status}")

        if resp.status == 403:
            print("Received 403 Forbidden. Check if the API Key is correct and associated with a usage plan for this stage.")

        return {"statusCode": 200, "body": json.dumps(f"Warmer finished. Ping status: {resp.status}")}
    except Exception as e:
        print(f"Warmer ping failed with exception: {e}")
        return {"statusCode": 200, "body": json.dumps(f"Warmer finished. Ping failed with exception: {str(e)}")}