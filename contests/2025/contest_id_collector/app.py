import sys
import os
# Add the 'package' directory to the Python path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'package'))

import boto3
import logging
import json
import requests
from pytz import timezone
from bs4 import BeautifulSoup

# --- Basic Setup ---
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# --- Centralized Configuration ---
class Config:
    """Houses all configuration variables for the contest crawler."""
    # AWS
    AWS_REGION = "ap-northeast-2"
    LAST_CHECKED_ID_PARAM_NAME = "/NP-Trend/Contest2025/LastCheckedID"
    RECHECK_IDS_PARAM_NAME = "/NP-Trend/Contest2025/RecheckIDs"
    S3_BUCKET_NAME = os.environ.get('S3_BUCKET_NAME')

    # Crawler Settings
    USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/108.0.0.0 Safari/537.36"
    REQUEST_TIMEOUT = 10  # 10 seconds
    FALLBACK_START_NOVEL_ID = 383395

    # S3 File Key
    S3_FILE_NAME = "contest_novel_ids_2025.json"
    # Novelpia URLs & Settings
    NOVEL_URL_TEMPLATE = "https://novelpia.com/novel/{}"
    SEOUL_TIMEZONE = timezone('Asia/Seoul')

    # CSS Selectors for Novel Detail Page
    class Selectors:
        ALERT_MODAL_MESSAGE = "#alert_modal .modal-body p"
        CONTEST_BADGE = "span.b_contest2"

if not Config.S3_BUCKET_NAME:
    raise ValueError("Environment variable S3_BUCKET_NAME must be set.")

# --- Logging Helper ---
def _log(level, execution_id, message, **kwargs):
    """Creates a structured log message."""
    log_data = {"execution_id": execution_id, "message": message, **kwargs}
    logger.log(level, json.dumps(log_data, ensure_ascii=False))

# --- AWS SSM Parameter Store Helper ---
def get_start_id(ssm_client, execution_id, fallback_start_id):
    """Gets the last checked ID from SSM, falling back to input if not found."""
    try:
        response = ssm_client.get_parameter(Name=Config.LAST_CHECKED_ID_PARAM_NAME)
        last_id = int(response['Parameter']['Value'])
        start_id = last_id + 1
        _log(logging.INFO, execution_id, f"Resuming from last checked ID {last_id}. Starting scan at {start_id}.", source="SSM")
        return start_id
    except ssm_client.exceptions.ParameterNotFound:
        _log(logging.INFO, execution_id, f"SSM parameter not found. Using fallback start_id: {fallback_start_id}.", source="Input")
        return fallback_start_id
    except Exception as e:
        _log(logging.WARNING, execution_id, f"Failed to get start_id from SSM: {e}. Using fallback: {fallback_start_id}.")
        return fallback_start_id

def update_last_checked_id(ssm_client, execution_id, last_checked_id):
    """Updates the last checked ID in SSM Parameter Store."""
    if not last_checked_id:
        _log(logging.WARNING, execution_id, "last_checked_id is None or 0. Skipping SSM update.")
        return
    try:
        ssm_client.put_parameter(
            Name=Config.LAST_CHECKED_ID_PARAM_NAME,
            Value=str(last_checked_id),
            Type='String',
            Overwrite=True
        )
        _log(logging.INFO, execution_id, f"Successfully updated last_checked_id in SSM to {last_checked_id}.")
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to update last_checked_id in SSM: {e}")

def get_recheck_ids(ssm_client, execution_id):
    """Gets the list of IDs to re-check from SSM."""
    try:
        response = ssm_client.get_parameter(Name=Config.RECHECK_IDS_PARAM_NAME)
        ids = json.loads(response['Parameter']['Value'])
        _log(logging.INFO, execution_id, f"Found {len(ids)} IDs to re-check.", source="SSM")
        return set(ids)
    except ssm_client.exceptions.ParameterNotFound:
        _log(logging.INFO, execution_id, "No re-check ID list found in SSM. Starting fresh.", source="SSM")
        return set()
    except (json.JSONDecodeError, Exception) as e:
        _log(logging.ERROR, execution_id, f"Failed to get or parse re-check IDs from SSM: {e}. Starting with an empty set.")
        return set()

def update_recheck_ids(ssm_client, execution_id, recheck_ids_set):
    """Updates the list of IDs to re-check in SSM."""
    if not isinstance(recheck_ids_set, set):
        _log(logging.ERROR, execution_id, "recheck_ids_set must be a set. Skipping update.")
        return

    id_list = sorted(list(recheck_ids_set))
    try:
        ssm_client.put_parameter(
            Name=Config.RECHECK_IDS_PARAM_NAME,
            Value=json.dumps(id_list),
            Type='String',
            Overwrite=True
        )
        _log(logging.INFO, execution_id, f"Successfully updated recheck_ids in SSM. New count: {len(id_list)}.")
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to update recheck_ids in SSM: {e}")

# --- S3 Helper ---
def upload_ids_to_s3(s3_client, execution_id, novel_ids):
    """Uploads the list of novel IDs to S3 as a JSON file."""
    try:
        s3_client.put_object(
            Bucket=Config.S3_BUCKET_NAME,
            Key=Config.S3_FILE_NAME,
            Body=json.dumps(novel_ids, ensure_ascii=False),
            ContentType='application/json'
        )
        _log(logging.INFO, execution_id, f"Successfully uploaded {len(novel_ids)} IDs to s3://{Config.S3_BUCKET_NAME}/{Config.S3_FILE_NAME}")
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to upload ID list to S3: {e}")

def get_previous_ids_from_s3(s3_client, execution_id):
    """Retrieves the previously stored list of novel IDs from S3."""
    try:
        response = s3_client.get_object(Bucket=Config.S3_BUCKET_NAME, Key=Config.S3_FILE_NAME)
        content = response['Body'].read().decode('utf-8')
        ids = json.loads(content)
        _log(logging.INFO, execution_id, f"Successfully retrieved {len(ids)} previous IDs from S3.")
        return set(ids)
    except s3_client.exceptions.NoSuchKey:
        _log(logging.INFO, execution_id, "S3 object not found. Assuming first run.")
        return set()
    except Exception as e:
        _log(logging.ERROR, execution_id, f"Failed to retrieve or parse IDs from S3: {e}. Starting with an empty set.")
        return set()

# =====================================================================================
# LAMBDA HANDLER: Get Contest Novel IDs by Incrementing
# =====================================================================================
def get_contest_novel_ids_by_increment(event, context):
    """
    Finds all contest novels by incrementing novel_id from a starting point.

    This function performs two scans:
    1. Incremental Scan: Scans for new novels from the last known ID. 
    2. Re-check Scan: Verifies previously inaccessible IDs.
    """
    execution_id = event.get('execution_id', 'N/A')

    # --- Input & AWS Client Initialization ---
    ssm_client = boto3.client('ssm', region_name=Config.AWS_REGION)
    s3_client = boto3.client('s3', region_name=Config.AWS_REGION)

    session = requests.Session()
    session.headers.update({"User-Agent": Config.USER_AGENT})

    # --- State Initialization ---
    previous_ids = get_previous_ids_from_s3(s3_client, execution_id)
    found_contest_ids = set()
    recheck_ids = get_recheck_ids(ssm_client, execution_id)
    processed_recheck_ids = set()
    newly_failed_ids = set()
    last_checked_id = Config.FALLBACK_START_NOVEL_ID - 1

    try:
        # --- 1. Incremental Scan ---
        start_id = get_start_id(ssm_client, execution_id, Config.FALLBACK_START_NOVEL_ID)
        _log(logging.INFO, execution_id, f"Starting incremental scan from ID {start_id}.")

        current_id = int(start_id)
        incremental_found_count = 0
        incremental_failed_count = 0
        incremental_not_contest_count = 0
        try:
            while True:
                is_contest, is_permanently_invalid, is_retriable_error = check_novel_status(session, current_id, execution_id)

                if is_contest:
                    found_contest_ids.add(current_id)
                    incremental_found_count += 1
                elif is_permanently_invalid:
                    _log(logging.INFO, execution_id, f"Found 'Invalid novel number' at ID {current_id}. Terminating incremental scan.")
                    break
                elif is_retriable_error:
                    newly_failed_ids.add(current_id)
                    incremental_failed_count += 1
                else: # Valid, but not a contest novel
                    incremental_not_contest_count += 1

                current_id += 1
        finally:
            last_checked_id = current_id - 1
            total_scanned = last_checked_id - start_id + 1
            # Verification: total_scanned should equal found + failed + not_contest
            _log(logging.INFO, execution_id,
                 "[Incremental Scan Summary]",
                 start_id=start_id, last_checked_id=last_checked_id, total_scanned=total_scanned,
                 found=incremental_found_count, failed_and_added_to_recheck=incremental_failed_count, not_contest=incremental_not_contest_count)

        # --- 2. Re-check Scan ---
        initial_recheck_count = len(recheck_ids)
        recheck_found_count = 0
        _log(logging.INFO, execution_id, f"Starting re-check scan for {len(recheck_ids)} IDs.")
        for novel_id in sorted(list(recheck_ids)):
            is_contest, _, _ = check_novel_status(session, novel_id, execution_id)
            if is_contest:
                found_contest_ids.add(novel_id)
                processed_recheck_ids.add(novel_id)  # Mark for removal from recheck list
                recheck_found_count += 1
        _log(logging.INFO, execution_id,
             "[Re-check Scan Summary]",
             total_to_recheck=initial_recheck_count, found_as_contest=recheck_found_count)

    except Exception as e:
        _log(logging.ERROR, execution_id, f"An unexpected error stopped the process: {e}", exc_info=True)
    finally:
        # --- 3. Finalize and Update State ---
        final_recheck_ids = (recheck_ids - processed_recheck_ids) | newly_failed_ids

        # Combine previously found IDs with IDs from the current scan
        complete_id_set = previous_ids | found_contest_ids

        _log(logging.INFO, execution_id,
             f"Collection finished. Found {len(found_contest_ids)} novels in this run. Total unique novels: {len(complete_id_set)}. "
             f"Last checked ID: {last_checked_id}.")

        update_last_checked_id(ssm_client, execution_id, last_checked_id)
        update_recheck_ids(ssm_client, execution_id, final_recheck_ids)

        # Upload the final, complete, and deduplicated list to S3
        upload_ids_to_s3(s3_client, execution_id, sorted(list(complete_id_set)))

    return {
        "status": "SUCCESS",
        "total_novels_in_s3": len(complete_id_set),
        "novels_found_this_run": len(found_contest_ids)
    }

def check_novel_status(session, novel_id, execution_id):
    """Checks a single novel ID and returns its status."""
    novel_url = Config.NOVEL_URL_TEMPLATE.format(novel_id)
    try:
        response = session.get(novel_url, timeout=Config.REQUEST_TIMEOUT)
        response.raise_for_status()
        soup = BeautifulSoup(response.text, 'html.parser')

        if alert_message_p := soup.select_one(Config.Selectors.ALERT_MODAL_MESSAGE):
            if "잘못된 소설 번호" in alert_message_p.get_text():
                return False, True, False # is_contest, is_permanently_invalid, is_retriable_error
            return False, False, True # Other alerts (private, etc.) are retriable

        if soup.select_one(Config.Selectors.CONTEST_BADGE):
            _log(logging.INFO, execution_id, f"Found contest novel: {novel_id}")
            return True, False, False
        
        return False, False, False # Valid novel, but not for contest

    except requests.exceptions.RequestException as e:
        _log(logging.WARNING, execution_id, f"Request failed for ID {novel_id}: {e}.")
        return False, False, True