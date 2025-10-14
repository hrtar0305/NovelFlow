# NP-Trend

A data engineering project to build a robust ETL pipeline for collecting and analyzing daily ranking data from [Novelpia](https://novelpia.com), with a web application for visualization.

[![Live Site](https://img.shields.io/badge/Live-Site-blue?style=for-the-badge)](https://d2ti06wylez2yq.cloudfront.net/)

---

## Features

-   **Daily Novel Rankings**: Provides daily rankings and change trends for top novels.
-   **Daily Tag Rankings**: Offers tag-specific scores and rankings based on novel ranking data.
-   **Novel Detail View**: Displays detailed metrics and trend charts for individual novels.
-   **Author's Works List**: Shows a list of all works by a specific author.
-   **Contest Rankings**: Allows viewing contest entry rankings by date for a specific year.
-   **Contest Tag Rankings**: Provides tag-specific scores and rankings for contest entries.
-   **Contest Novel Detail View**: Displays detailed metrics and trend charts for individual contest novels.
-   **Advanced Tag Filtering**: Supports complex tag searches using `AND`, `OR`, `NOT`, and parentheses.
-   **Data Trend Analysis**: Visualizes rising, falling, popular, and volatile tags based on trend analysis.
-   **Responsive UI**: Optimized user interface for both desktop and mobile environments.


---

## Tech Stack & Architecture

| Category      | Technologies                                                              |
|---------------|---------------------------------------------------------------------------|
| **Data Pipeline** | Python, AWS Step Functions, AWS Lambda, Amazon SQS, Playwright, BeautifulSoup, Requests |
| **Storage**     | Amazon DynamoDB, Amazon S3                                                |
| **Web App**     | FastAPI, React, TypeScript, Recharts, Algolia                             |
| **Infra**       | Amazon EventBridge, AWS Parameter Store                                   |

---

## ETL Pipeline Architecture

The core of this project consists of two distinct serverless ETL pipelines, both orchestrated by **AWS Step Functions** and triggered by **Amazon EventBridge**. The architecture prioritizes robustness, scalability, and data integrity.

### 1. Daily Ranking Pipeline (`crawler`)

The process for daily ranking data is managed by a Standard Workflow (`NpTrendCrawlerWorkflow.json`) which orchestrates several Lambda functions and an Express Workflow.

1.  **Initiation & Preparation (`get_ranking_list` Lambda)**
    -   **Trigger**: An Amazon EventBridge rule triggers the Step Functions workflow daily.
    -   **Queue Purge**: The first step is to send a purge request to the Amazon SQS queue to ensure a clean start for the day's batch.
    -   **Authentication**: Retrieves login credentials securely from AWS Parameter Store.
    -   **Crawling**: Launches a headless browser using **Playwright**, logs into Novelpia, and crawls the top 500 novels from the '7-day' ranking page.
    -   **Output**: Returns a list of 500 novels with basic information (ID, rank, score) and the total count to the next step.

2.  **Parallel Parsing (`NpTrendCrawlerExpressWorkflow.json`)**
    -   The Standard Workflow invokes an **Express Workflow** to efficiently process each novel's details in parallel.
    -   The Express Workflow utilizes a `Map` state, which iterates through the list of 500 novels.
    -   With `MaxConcurrency` set to 20, it invokes the `parse_novel_details` Lambda for up to 20 novels simultaneously, significantly reducing total processing time.

3.  **Detailed Parsing (`parse_novel_details` Lambda)**
    -   **Scraping**: Receives information for a single novel, scrapes its dedicated page for detailed data (synopsis, author, tags, etc.) using `requests` and `BeautifulSoup`.
    -   **Error Handling**: If a novel is inaccessible (e.g., deleted or private), it generates a placeholder item to maintain the integrity of the 500-item dataset. The Step Function is configured to retry on failure, and as a final fallback, it calls the same Lambda with a flag to create a placeholder, ensuring every novel is accounted for.
    -   **Queueing**: The parsed data (or placeholder) is sent as a message to an **Amazon SQS** queue. This decouples the parsing stage from the final data storage, enhancing fault tolerance.

4.  **Consolidation & Storage (`consolidate_data` Lambda)**
    -   **Data Retrieval**: After the parallel processing is complete, this function is triggered. It polls the SQS queue until it has retrieved all 500 messages or a timeout is reached.
    -   **Data Integrity Check**: The first critical action is to validate that the number of retrieved messages matches the expected count (500). If not, the process fails to prevent incomplete data from being saved.
    -   **Commit Phase**:
        1.  **Archiving**: The complete, validated dataset is converted to a CSV file and uploaded to an **Amazon S3** bucket for backup and archival.
        2.  **Loading**: The data is then batch-written into an **Amazon DynamoDB** table. Daily statistics (e.g., tag scores) are also calculated and stored in a separate `STATS#<date>` item.
        3.  **Message Deletion**: Only after the data has been successfully archived to S3 and loaded into DynamoDB, the messages are deleted from the SQS queue. This "validate, load, then delete" pattern ensures data is not lost if a failure occurs during the storage phase.

### 2. Contest Data Pipeline (`contest`)

To handle a larger and growing number of contest novels (1,800+), a more advanced and cost-effective architecture was developed. This pipeline avoids the 5-minute execution limit of Express Workflows and minimizes Step Functions state transition costs.

1.  **Task Distribution (`get_id_list_from_s3` Lambda)**
    -   **Trigger**: Triggered by a main Step Functions workflow (`NpTrendContestDataPipelineMainWorkflow.json`).
    -   **Queue Purge**: Clears both the "Task Queue" and "Result Queue" to ensure a clean run, waiting for confirmation that the queues are empty.
    -   **Fan-Out**: Reads a master list of novel IDs from S3 and sends each ID as an individual message to a **Task SQS Queue**. This "fan-out" process decouples task distribution from the main workflow.

2.  **Scalable Parallel Parsing (`parser` Lambda)**
    -   **Trigger**: This Lambda is triggered directly by messages arriving in the "Task SQS Queue", with a batch size of 100.
    -   **Controlled Concurrency**: Lambda's **Reserved Concurrency** is set to a specific number (e.g., 20) to balance processing speed and server load, while the batch size is increased (e.g., 100) for cost-effective processing.
    -   **Robust Parsing**: Uses lightweight `requests` and `BeautifulSoup` for fast and efficient data scraping. It includes logic to fetch first/latest episode information for retention rate calculation.
    -   **Error Handling**:
        -   For permanent errors (e.g., a novel is now private or a parsing error occurs), a placeholder item is generated.
        -   For persistent transient errors (after several retries), the Lambda fails, allowing SQS to automatically requeue the message batch for another attempt.
    -   **Queueing**: Successfully parsed data and placeholders are sent to a **Result SQS Queue**.

3.  **Dynamic Completion Check (Step Functions Loop)**
    -   The main workflow enters a "Wait and Check" loop.
    -   A `check_completion` Lambda periodically checks the number of messages in the "Result SQS Queue".
    -   Once the message count matches the total number of fanned-out tasks, the workflow proceeds to the final step. This is far more efficient than a fixed wait time.

4.  **Consolidation & Storage (`consolidate_data` Lambda)**
    -   **Data Retrieval & Validation**: Collects all messages from the "Result SQS Queue", deduplicates them (to handle potential SQS retries), and validates that the total count matches the expected number.
    -   **Data Processing**: Calculates `RetentionRate` for valid items.
    -   **Commit Phase**: Batch-writes the final, clean data to DynamoDB and then deletes the messages from the SQS queue. The Step Functions `Retry` policy for this step is configured with a long interval to safely handle failures without causing race conditions with SQS's visibility timeout.

### Web Application (Visualization Layer)

The web application serves as a user-friendly interface to explore the collected data.

-   **Backend**: A serverless API built with Python and **FastAPI**, deployed on **AWS Lambda** via Mangum. It queries the DynamoDB table to serve data to the frontend.
-   **Frontend**: A Single-Page Application (SPA) built with **React** and **TypeScript**, using **Recharts** for interactive data visualization.

---

## Data Collection Strategy

The data collection strategy is designed to provide a stable and comprehensive view of trends on the platform. This project collects two main types of data.

### 1. Novel Ranking Data

-   **Source**: Novelpia real-time view count ranking (7-day, all types).
-   **Scope**: Top **500** novels (300 until 2025.07.20).
-   **Frequency**: Daily at 9:00 PM (KST).

### 2. Contest Ranking Data (e.g., 2025 Contest)

-   **Source**: Novelpia '우주최강 공모전' entries list.
-   **Scope**: All novels participating in the contest.
-   **Frequency**: Daily at 2:00 PM (KST).

### Rationale for '7-Day' Ranking

The '24-hour' ranking only includes a novel that has uploaded a new episode within 24 hours, often excluding popular but slow-updating or completed works. In contrast, the **'7-day' ranking** provides a more stable and inclusive measure of a novel's ongoing popularity by considering cumulative views over a week. This makes it a more suitable metric for tracking broader trends, which is the primary goal of this project.

### Data Integrity and Reliability

Several measures are in place to ensure the reliability, integrity, and timeliness of the collected data:

-   **Decoupled Architecture**: Using SQS as a buffer between the parsing and storage stages prevents data loss if the database is temporarily unavailable.
-   **Timeliness of Ranking Data**: The most time-sensitive data is the daily ranking. To ensure this data is captured as close to the 9:00 PM KST target as possible, the initial ranking crawl (`get_ranking_list` Lambda) is designed as a minimal, separate step. The most common failure at this stage is the discovery of duplicate items within Novelpia's source ranking data. By isolating this volatile step, failures can be detected and retried rapidly without restarting the entire, lengthy parsing process. This design choice is critical for maintaining a consistent 24-hour data collection cycle.
-   **Atomic Operations**: The "validate, load, then delete" pattern for SQS messages ensures that data is only removed from the queue after it has been successfully and completely stored, preventing data loss during the commit phase.
-   **Comprehensive Error Handling**: The Step Functions workflow includes automated retries for transient errors. For persistent parsing failures on a specific novel, a placeholder is created to maintain the dataset's completeness (i.e., always 500 records per day).
-   **Data Validation**: An explicit count check is performed before storing data, ensuring that an incomplete batch from a partial failure is never saved as the day's official record.

---

## License

This project is licensed under the [MIT License](LICENSE).