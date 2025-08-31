import { Card } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';

interface TrendCardProps {
  title: string;
  description: string;
  to: string;
}

const TrendCard: React.FC<TrendCardProps> = ({ title, description, to }) => {
  const navigate = useNavigate();

  const handleClick = () => {
    navigate(to);
  };

  return (
    <Card
      className="trend-card mb-3 cursor-pointer shadow-sm"
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      <Card.Body>
        <Card.Title>{title}</Card.Title>
        <Card.Text className="text-muted">{description}</Card.Text>
      </Card.Body>
    </Card>
  );
};

export default TrendCard;
