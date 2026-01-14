import { useShow, useList } from "@refinedev/core";
import { Show, ListButton } from "@refinedev/antd";
import {
  Typography,
  Card,
  Row,
  Col,
  Descriptions,
  Table,
  Space,
  Button,
  Statistic,
  Tag,
} from "antd";
import { SwapOutlined, TeamOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router-dom";
import type { Company, Shareholding, Transaction } from "../../types/database";

const { Text } = Typography;

export const CompanyShow: React.FC = () => {
  const { query } = useShow<Company>();
  const { data, isLoading } = query;
  const record = data?.data;
  const navigate = useNavigate();

  // Fetch shareholdings for this company
  const { result: shareholdingsResult } = useList<Shareholding>({
    resource: "shareholdings",
    filters: [{ field: "company_id", operator: "eq", value: record?.id }],
    queryOptions: { enabled: !!record?.id },
  });

  // Fetch recent transactions
  const { result: transactionsResult } = useList<Transaction>({
    resource: "transactions",
    filters: [{ field: "company_id", operator: "eq", value: record?.id }],
    sorters: [{ field: "transaction_date", order: "desc" }],
    pagination: { pageSize: 5 },
    queryOptions: { enabled: !!record?.id },
  });

  const formatDate = (dateString?: string) => {
    if (!dateString) return "-";
    return new Date(dateString).toLocaleDateString("nb-NO");
  };

  const getTransactionTypeLabel = (type: string) => {
    const labels: Record<string, string> = {
      founding: "Stiftelse",
      transfer: "Overføring",
      issue: "Emisjon",
      dividend: "Utbytte",
    };
    return labels[type] || type;
  };

  const getTransactionTypeColor = (type: string) => {
    const colors: Record<string, string> = {
      founding: "green",
      transfer: "blue",
      issue: "purple",
      dividend: "gold",
    };
    return colors[type] || "default";
  };

  return (
    <Show
      isLoading={isLoading}
      headerButtons={
        <Space>
          <Button
            type="primary"
            icon={<SwapOutlined />}
            onClick={() => navigate(`/transactions/create?company_id=${record?.id}`)}
          >
            Ny transaksjon
          </Button>
          <ListButton />
        </Space>
      }
    >
      <Row gutter={[24, 24]}>
        <Col span={16}>
          <Card title="Selskapsinformasjon">
            <Descriptions column={2} bordered size="small">
              <Descriptions.Item label="Selskapsnavn" span={2}>
                <Text strong>{record?.name}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Organisasjonsnummer">
                <Text code>{record?.org_number}</Text>
              </Descriptions.Item>
              <Descriptions.Item label="Stiftelsesdato">
                {formatDate(record?.founding_date ?? undefined)}
              </Descriptions.Item>
              <Descriptions.Item label="Adresse" span={2}>
                {record?.address}
                {record?.postal_code && record?.city && (
                  <>, {record.postal_code} {record.city}</>
                )}
              </Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>

        <Col span={8}>
          <Card title="Aksjekapital">
            <Statistic
              title="Aksjekapital"
              value={record?.share_capital || 0}
              precision={0}
              suffix="NOK"
              valueStyle={{ color: "#1890ff" }}
            />
            <Row gutter={16} style={{ marginTop: 16 }}>
              <Col span={12}>
                <Statistic title="Antall aksjer" value={record?.total_shares || 0} />
              </Col>
              <Col span={12}>
                <Statistic title="Pålydende" value={record?.par_value || 0} precision={2} suffix="NOK" />
              </Col>
            </Row>
          </Card>
        </Col>

        <Col span={24}>
          <Card title={<Space><TeamOutlined />Aksjonærer</Space>}>
            <Table
              dataSource={shareholdingsResult?.data || []}
              rowKey="id"
              pagination={false}
              size="small"
            >
              <Table.Column title="Aksjonær" dataIndex="shareholder_id" />
              <Table.Column
                title="Antall aksjer"
                dataIndex="num_shares"
                render={(value: number) => value?.toLocaleString("nb-NO")}
              />
              <Table.Column
                title="Eierandel"
                dataIndex="ownership_percentage"
                render={(value: number) => `${value?.toFixed(2)}%`}
              />
            </Table>
          </Card>
        </Col>

        <Col span={24}>
          <Card
            title={<Space><SwapOutlined />Siste transaksjoner</Space>}
            extra={<Button type="link" onClick={() => navigate(`/transactions?company_id=${record?.id}`)}>Se alle</Button>}
          >
            <Table
              dataSource={transactionsResult?.data || []}
              rowKey="id"
              pagination={false}
              size="small"
            >
              <Table.Column title="Dato" dataIndex="transaction_date" render={(v: string) => formatDate(v)} />
              <Table.Column
                title="Type"
                dataIndex="transaction_type"
                render={(v: string) => <Tag color={getTransactionTypeColor(v)}>{getTransactionTypeLabel(v)}</Tag>}
              />
              <Table.Column title="Beskrivelse" dataIndex="description" render={(v: string) => v || "-"} />
              <Table.Column title="Aksjer før" dataIndex="shares_before" render={(v: number) => v?.toLocaleString("nb-NO")} />
              <Table.Column title="Aksjer etter" dataIndex="shares_after" render={(v: number) => v?.toLocaleString("nb-NO")} />
            </Table>
          </Card>
        </Col>
      </Row>
    </Show>
  );
};
