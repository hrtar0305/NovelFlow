import React from 'react';
import { Card, ListGroup, Accordion, Alert } from 'react-bootstrap';

const DataCollectionPage = () => {
  return (
    <div className="p-4 lg:container mx-auto">
      <Card>
        <Card.Header>
          <h1 className="h3 mb-0">데이터 수집 및 랭킹 기준</h1>
        </Card.Header>
        <Card.Body>
          <p className="lead">본 웹사이트에서 제공하는 데이터의 출처, 수집 방식 및 기준은 다음과 같습니다.</p>
          
          <h2 className="h5 mt-4">데이터 수집 개요</h2>
          <ListGroup>
            <ListGroup.Item>
              <strong>수집 시각:</strong> 매일 오후 9시 (한국 시간 기준). 단, 시스템 오류로 인해 최대 1시간의 지연 또는 수집 실패가 발생할 수 있습니다.
            </ListGroup.Item>
            <ListGroup.Item>
              <strong>데이터 소스:</strong> <a href="https://novelpia.com/top100/all/weekly/view/all/all/" target="_blank" rel="noopener noreferrer">노벨피아 실시간 조회순 랭킹 (7일, 전체)</a> 페이지를 기준으로 합니다.
            </ListGroup.Item>
            <ListGroup.Item>
              <strong>수집 범위:</strong> 위 페이지의 500위(2025년 7월 21일 이전은 300위)까지의 소설 데이터를 수집합니다. 따라서 수집 기간 내 한 번도 순위권에 들지 못한 소설은 사이트에 표시되지 않습니다.
            </ListGroup.Item>
          </ListGroup>

          <h2 className="h5 mt-4">랭킹 기준 상세 설명</h2>
          <Accordion defaultActiveKey="0">
            <Accordion.Item eventKey="0">
              <Accordion.Header>Q. 왜 '24시간'이 아닌 '7일' 조회수 랭킹을 사용하나요?</Accordion.Header>
              <Accordion.Body>
                <p>노벨피아의 '24시간 조회순' 랭킹은 최근 24시간 내 등록된 회차의 조회수를 기준으로 하므로, 연재 주기가 길거나 완결된 소설은 랭킹에서 제외됩니다. 이는 다양한 작품의 인기도 변화를 꾸준히 추적하려는 본 사이트의 목적과 맞지 않습니다.</p>
                <p>반면, '7일 조회순' 랭킹은 지난 7일간의 누적 조회수를 기준으로 하여 완결작이나 연재 지연작도 포함하므로, 보다 폭넓고 안정적인 인기도 지표를 제공한다고 판단했습니다. 이는 랭킹에 포함된 작품들의 연재 상태와 점수 스케일을 분석하여 내린 결론입니다.</p>
                <p className="mb-0">따라서 일일 순위 변화를 가장 종합적으로 보여주기에 '7일 조회순' 랭킹이 가장 적합하다고 판단했습니다.</p>
              </Accordion.Body>
            </Accordion.Item>
            <Accordion.Item eventKey="1">
              <Accordion.Header>Q. 수집된 데이터를 기반으로 랭킹을 새로 계산하지 않는 이유는 무엇인가요?</Accordion.Header>
              <Accordion.Body>
                <p>수집된 데이터(총 조회수, 7일 랭킹 점수 등)를 가공하여 '일일 순수 조회수' 랭킹을 만드는 것은 여러 한계가 있습니다.</p>
                <ul>
                  <li><strong>부정확성:</strong> 노벨피아의 랭킹 점수와 사이트에서 보이는 총 조회수 증감분은 완전히 일치하지 않습니다. 외부에서 수집한 불완전한 값으로 새로운 랭킹을 만드는 것은 오히려 데이터의 신뢰도를 해칠 수 있습니다.</li>
                  <li><strong>데이터 공백:</strong> 랭킹은 500위까지만 수집되므로, 순위권 밖으로 밀려난 소설은 해당 날짜의 데이터가 없어 정확한 조회수 추적이 불가능합니다.</li>
                  <li><strong>기술적 한계:</strong> 노벨피아의 모든 소설(약 38만 개) 데이터를 매일 수집하는 것은 현실적으로 어렵습니다.</li>
                </ul>
                <p className="mb-0">따라서, 비록 7일 기준이지만 노벨피아에서 공식적으로 제공하는 순위를 그대로 기록하고 보여주는 것이 가장 현실적이고 정확한 방법이라고 판단했습니다.</p>
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>

          <h2 className="h5 mt-4">주의사항</h2>
          <Alert variant="warning">
            <ul className="mb-0 ps-3">
              <li>본 사이트의 랭킹은 <strong>7일간의 누적 조회수</strong>를 기준으로 하므로, 일일 조회수 기반의 순위 변동과는 체감상 차이가 있을 수 있습니다.</li>
              <li>노벨피아에서 공식 제공하는 '주간 Top 100'과도 집계 방식이 다르므로 순위가 일치하지 않습니다.</li>
              <li>데이터 수집 시각은 기준 시각(오후 9시)에서 최대 1시간의 오차가 발생할 수 있어 완벽한 24시간 주기의 데이터가 아닐 수 있습니다.</li>
            </ul>
          </Alert>
        </Card.Body>
      </Card>
    </div>
  );
};

export default DataCollectionPage;