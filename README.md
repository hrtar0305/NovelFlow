# NP-Trend

A data engineering project to build a robust ETL pipeline for collecting and analyzing daily ranking data from [Novelpia](https://novelpia.com), with a web application for visualization.

[![Live Site](https://img.shields.io/badge/Live-Site-blue?style=for-the-badge)](https://d2ti06wylez2yq.cloudfront.net/)

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

The core of this project is a serverless ETL pipeline designed for daily, automated data collection. It is orchestrated by **AWS Step Functions** and triggered by **Amazon EventBridge**. The architecture prioritizes robustness, scalability, and data integrity.

The process is managed by a Standard Workflow (`NpTrendCrawlerWorkflow.json`) which orchestrates several Lambda functions and an Express Workflow.

1.  **Initiation & Preparation (`get_ranking_list` Lambda)**
    -   **Trigger**: An Amazon EventBridge rule triggers the Step Functions workflow daily.
    -   **Queue Purge**: The first step is to send a purge request to the Amazon SQS queue to ensure a clean start for the day's batch.
    -   **Authentication**: Retrieves login credentials securely from AWS Parameter Store.
    -   **Crawling**: Launches a headless browser using **Playwright**, logs into Novelpia, and crawls the top 500 novels from the '7-day' ranking page.
    -   **Output**: Returns a list of 500 novels with basic information (ID, rank, score) and the total count to the next step.

2.  **Parallel Processing (`NpTrendCrawlerExpressWorkflow.json`)**
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

### Web Application (Visualization Layer)

The web application serves as a user-friendly interface to explore the collected data.

-   **Backend**: A serverless API built with Python and **FastAPI**, deployed on **AWS Lambda** via Mangum. It queries the DynamoDB table to serve data to the frontend.
-   **Frontend**: A Single-Page Application (SPA) built with **React** and **TypeScript**, using **Recharts** for interactive data visualization.
-   **Search**: **Algolia** is used to provide a fast and responsive search experience for novels and authors.

---

## Data Collection Strategy

The data collection strategy is designed to provide a stable and comprehensive view of trends on the platform.

### Data Source & Scope

-   **Source**: Novelpia real-time view count ranking (7-day, all types).
-   **Scope**: Top **500** novels (300 until 2025.07.20).
-   **Frequency**: Daily at 9:00 PM (KST).

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