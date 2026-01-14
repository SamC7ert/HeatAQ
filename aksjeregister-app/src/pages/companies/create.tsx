import { Create, useForm } from "@refinedev/antd";
import { Form, Input, InputNumber, DatePicker, Row, Col, Card, Typography, Divider } from "antd";
import type { Company } from "../../types/database";

const { Text } = Typography;

export const CompanyCreate: React.FC = () => {
  const { formProps, saveButtonProps, form } = useForm<Company>();

  // Calculate share capital from shares and par value
  const handleValuesChange = () => {
    const values = form.getFieldsValue() as Record<string, number>;
    const totalShares = values.total_shares || 0;
    const parValue = values.par_value || 0;
    form.setFieldValue("share_capital", totalShares * parValue);
  };

  return (
    <Create saveButtonProps={saveButtonProps}>
      <Form
        {...formProps}
        layout="vertical"
        onValuesChange={handleValuesChange}
        initialValues={{
          country: "NO",
          par_value: 1,
          total_shares: 100,
          share_capital: 100,
        }}
      >
        <Row gutter={24}>
          <Col span={12}>
            <Card title="Selskapsinformasjon" size="small">
              <Form.Item
                label="Selskapsnavn"
                name="name"
                rules={[{ required: true, message: "Selskapsnavn er påkrevd" }]}
              >
                <Input placeholder="Eksempel AS" />
              </Form.Item>

              <Form.Item
                label="Organisasjonsnummer"
                name="org_number"
                rules={[
                  { required: true, message: "Org.nr. er påkrevd" },
                  { pattern: /^\d{9}$/, message: "Org.nr. må være 9 siffer" },
                ]}
              >
                <Input placeholder="123456789" maxLength={9} />
              </Form.Item>

              <Form.Item label="Stiftelsesdato" name="founding_date">
                <DatePicker style={{ width: "100%" }} format="DD.MM.YYYY" />
              </Form.Item>
            </Card>
          </Col>

          <Col span={12}>
            <Card title="Adresse" size="small">
              <Form.Item label="Adresse" name="address">
                <Input placeholder="Gateadresse 1" />
              </Form.Item>

              <Row gutter={16}>
                <Col span={8}>
                  <Form.Item label="Postnummer" name="postal_code">
                    <Input placeholder="0001" maxLength={4} />
                  </Form.Item>
                </Col>
                <Col span={16}>
                  <Form.Item label="Sted" name="city">
                    <Input placeholder="Oslo" />
                  </Form.Item>
                </Col>
              </Row>
            </Card>
          </Col>
        </Row>

        <Divider />

        <Card title="Aksjekapital" size="small">
          <Row gutter={24}>
            <Col span={8}>
              <Form.Item
                label="Antall aksjer"
                name="total_shares"
                rules={[{ required: true, message: "Antall aksjer er påkrevd" }]}
              >
                <InputNumber style={{ width: "100%" }} min={1} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item
                label="Pålydende per aksje (NOK)"
                name="par_value"
                rules={[{ required: true, message: "Pålydende er påkrevd" }]}
              >
                <InputNumber style={{ width: "100%" }} min={0.01} precision={2} />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item label="Aksjekapital (NOK)" name="share_capital">
                <InputNumber style={{ width: "100%" }} disabled />
              </Form.Item>
              <Text type="secondary" style={{ fontSize: 12 }}>
                Beregnes automatisk: antall aksjer × pålydende
              </Text>
            </Col>
          </Row>
        </Card>
      </Form>
    </Create>
  );
};
