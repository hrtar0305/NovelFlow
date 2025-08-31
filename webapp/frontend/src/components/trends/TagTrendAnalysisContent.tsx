import React from 'react';
import { Card, ListGroup, Badge, Row, Col } from 'react-bootstrap';
import { ArrowUpCircleFill, ArrowDownCircleFill, StarFill, TrashFill } from 'react-bootstrap-icons';

// Define the Tag type directly as it's not exported from api.ts
interface Tag {
  TagName: string;
  ViewCount: number;
  Rank: number;
}

interface TagChange {
  name: string;
  startRank: number | null;
  endRank: number | null;
  change: number;
}

interface TagTrendAnalysisContentProps {
  risingTags: TagChange[];
  fallingTags: TagChange[];
  newTags: Tag[];
  droppedTags: Tag[];
  startDate: string;
  endDate: string;
}

const TrendList: React.FC<{ title: string; tags: TagChange[]; icon: React.ReactNode; variant: 'success' | 'danger' }> = ({ title, tags, icon, variant }) => (
  <Card>
    <Card.Header className={`bg-${variant} bg-opacity-10 border-${variant} border-opacity-25`}>
      <h5 className="mb-0 d-flex align-items-center">
        {icon}
        <span className="ms-2">{title}</span>
      </h5>
    </Card.Header>
    <ListGroup variant="flush">
      {tags.length > 0 ? tags.map(tag => (
        <ListGroup.Item key={tag.name} className="d-flex justify-content-between align-items-center">
          <span>
            <Badge bg="secondary" className="me-2">{tag.endRank}</Badge>
            {tag.name}
          </span>
          <Badge pill bg={variant} text="dark" className="d-flex align-items-center">
            {tag.change > 0 ? `+${tag.change}` : tag.change}
            <small className="ms-2 text-muted">({tag.startRank}위)</small>
          </Badge>
        </ListGroup.Item>
      )) : <ListGroup.Item className="text-muted">해당 태그가 없습니다.</ListGroup.Item>}
    </ListGroup>
  </Card>
);

const SimpleList: React.FC<{ title: string; tags: Tag[]; icon: React.ReactNode; variant: 'primary' | 'secondary' }> = ({ title, tags, icon, variant }) => (
    <Card>
      <Card.Header className={`bg-${variant} bg-opacity-10 border-${variant} border-opacity-25`}>
        <h5 className="mb-0 d-flex align-items-center">
          {icon}
          <span className="ms-2">{title}</span>
        </h5>
      </Card.Header>
      <ListGroup variant="flush">
        {tags.length > 0 ? tags.map(tag => (
          <ListGroup.Item key={tag.TagName}>{tag.TagName}</ListGroup.Item>
        )) : <ListGroup.Item className="text-muted">해당 태그가 없습니다.</ListGroup.Item>}
      </ListGroup>
    </Card>
  );

const TagTrendAnalysisContent: React.FC<TagTrendAnalysisContentProps> = ({ risingTags, fallingTags, newTags, droppedTags, startDate, endDate }) => {
  if (!risingTags && !fallingTags && !newTags && !droppedTags) {
    return <p className="text-center text-muted">데이터를 분석 중이거나 표시할 데이터가 없습니다.</p>;
  }

  return (
    <div>
        <p className="text-center text-muted mb-4">{startDate} vs {endDate}</p>
        <Row>
            <Col key="rising" md={6} className="mb-4">
                <TrendList 
                    title="급상승 태그" 
                    tags={risingTags} 
                    icon={<ArrowUpCircleFill className="text-success" />} 
                    variant="success"
                />
            </Col>
            <Col key="falling" md={6} className="mb-4">
                <TrendList 
                    title="급하락 태그" 
                    tags={fallingTags} 
                    icon={<ArrowDownCircleFill className="text-danger" />} 
                    variant="danger"
                />
            </Col>
            <Col key="new" md={6} className="mb-4">
                <SimpleList 
                    title="신규 진입 태그" 
                    tags={newTags} 
                    icon={<StarFill className="text-primary" />} 
                    variant="primary"
                />
            </Col>
            <Col key="dropped" md={6} className="mb-4">
                <SimpleList 
                    title="순위 이탈 태그" 
                    tags={droppedTags} 
                    icon={<TrashFill className="text-secondary" />} 
                    variant="secondary"
                />
            </Col>
        </Row>
    </div>
  );
};

export default TagTrendAnalysisContent;
