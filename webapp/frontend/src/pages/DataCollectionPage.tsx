import React from 'react';
import { Card, ListGroup, Badge } from 'react-bootstrap';
import { ArrowRight } from 'react-bootstrap-icons';

const DataCollectionPage = () => {
  return (
    <div className="p-4 lg:container mx-auto">
      <Card>
        <Card.Header>
          <h1 className="h3 mb-0">데이터 수집 및 처리 방식</h1>
        </Card.Header>
        <Card.Body>
          <p className="lead">본 웹사이트의 데이터는 다음과 같은 자동화된 파이프라인을 통해 수집 및 처리됩니다.</p>
          
          <h2 className="h5 mt-4">1. 크롤링 (Crawling)</h2>
          <ListGroup horizontal className="text-center mb-3">
            <ListGroup.Item className="flex-fill">Playwright 기반 크롤러</ListGroup.Item>
            <ListGroup.Item className="flex-fill d-flex align-items-center justify-content-center"><ArrowRight /></ListGroup.Item>
            <ListGroup.Item className="flex-fill">AWS Lambda 실행</ListGroup.Item>
            <ListGroup.Item className="flex-fill d-flex align-items-center justify-content-center"><ArrowRight /></ListGroup.Item>
            <ListGroup.Item className="flex-fill">SQS 메시지 전송</ListGroup.Item>
          </ListGroup>
          <p>
            매일 정해진 시간에 AWS Step Functions 워크플로우가 트리거되어 Playwright 기반의 크롤러를 AWS Lambda 환경에서 실행합니다. 크롤러는 랭킹 데이터를 수집하고 개별 작품 정보를 파싱한 후, 수집된 데이터를 SQS(Simple Queue Service)를 통해 메시지로 전송합니다.
          </p>

          <h2 className="h5 mt-4">2. 데이터 취합 및 저장</h2>
          <ListGroup horizontal className="text-center mb-3">
            <ListGroup.Item className="flex-fill">SQS 메시지 수신</ListGroup.Item>
            <ListGroup.Item className="flex-fill d-flex align-items-center justify-content-center"><ArrowRight /></ListGroup.Item>
            <ListGroup.Item className="flex-fill">CSV 파일로 병합</ListGroup.Item>
            <ListGroup.Item className="flex-fill d-flex align-items-center justify-content-center"><ArrowRight /></ListGroup.Item>
            <ListGroup.Item className="flex-fill">S3 버킷에 업로드</ListGroup.Item>
          </ListGroup>
          <p>
            별도의 Lambda 함수가 SQS 큐의 메시지들을 수집하여 하나의 CSV 파일로 취합하고, 이 파일을 AWS S3 버킷에 업로드합니다.
          </p>

          <h2 className="h5 mt-4">3. 데이터 처리 및 적재</h2>
           <ListGroup horizontal className="text-center mb-3">
            <ListGroup.Item className="flex-fill">S3 이벤트 트리거</ListGroup.Item>
            <ListGroup.Item className="flex-fill d-flex align-items-center justify-content-center"><ArrowRight /></ListGroup.Item>
            <ListGroup.Item className="flex-fill">Lambda 함수 실행</ListGroup.Item>
            <ListGroup.Item className="flex-fill d-flex align-items-center justify-content-center"><ArrowRight /></ListGroup.Item>
            <ListGroup.Item className="flex-fill">DynamoDB에 저장</ListGroup.Item>
          </ListGroup>
          <p>
            S3 버킷에 CSV 파일이 업로드되면, S3 이벤트가 Lambda 함수(`data_ingestion.py`)를 자동으로 트리거합니다. 이 함수는 CSV 데이터를 읽어 정제한 후, 최종적으로 NoSQL 데이터베이스인 DynamoDB의 `NovelRanks` 테이블에 저장합니다. 웹사이트는 이 DynamoDB의 데이터를 기반으로 사용자에게 랭킹 정보를 제공합니다.
          </p>

          <div className="mt-4">
            <Badge bg="secondary" className="me-2">Playwright</Badge>
            <Badge bg="secondary" className="me-2">AWS Lambda</Badge>
            <Badge bg="secondary" className="me-2">AWS SQS</Badge>
            <Badge bg="secondary" className="me-2">AWS S3</Badge>
            <Badge bg="secondary" className="me-2">AWS DynamoDB</Badge>
            <Badge bg="secondary" className="me-2">AWS Step Functions</Badge>
          </div>
        </Card.Body>
      </Card>
    </div>
  );
};

export default DataCollectionPage;