import {
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
} from "@material-ui/core";
import Alert from '@mui/material/Alert';
import Snackbar from '@mui/material/Snackbar';
import { Button, Input } from "@saleor/macaw-ui";
import { useRouter } from "next/router";
import { useState } from "react";
import { create } from 'zustand';
import { OrderLine, useFulFillOrderMutation, useGetOrdersQuery, useMetadataUpdateMutation } from "../../../../generated/graphql";

const useErrorStore = create((set: any) => ({
  errorMessage: '',
  isOpen: false,
  setErrorMessage: (message: string) => set({ errorMessage: message }),
  closeError: () => set({ isOpen: false }),
  OpenError: () => set({ isOpen: true }),
}))

function Order({ row, i }: { row: any, i: number }) {
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingURL, setTrackingURL] = useState("");
  const OpenError = useErrorStore().OpenError
  const setErrorMessage = useErrorStore().setErrorMessage
  const [__, setFulFillOrder] = useFulFillOrderMutation();
  const [_, setMetaData] = useMetadataUpdateMutation();
  const router = useRouter();

  const SetOrderFullFill = async (order: any) => {
    const lines = order.lines.map((line: OrderLine) => {
      return {
        stocks: [{ quantity: line.quantity, warehouse: order.channel.warehouses[0].id }],
        orderLineId: line.id
      }
    })
    const { error } = await setFulFillOrder({
      orderId: order.id,
      input: {
        lines: lines,
        notifyCustomer: true,
        trackingNumber: trackingNumber
      }
    })
    if (error) {
      setErrorMessage(error.message)
      OpenError()
      console.log(error)
    }
    setMetaData({
      id: order.id,
      input: [{
        key: 'tracking_url_provider',
        value: trackingURL
      }],
    })
    router.reload();
  }

  const OnSaveClick = async (order: any) => {
    if (!trackingNumber || !trackingURL) {
      setErrorMessage("Traking Number or Tracking URL fields are empty")
      OpenError()
      return
    }
    SetOrderFullFill(order)
  };

  return (
    <>
      <TableCell>{i + 1}.</TableCell>
      <TableCell>
        {row.node.number}
      </TableCell>
      <TableCell>{row.node.created}</TableCell>
      <TableCell>
        <Input
          type="number"
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Input
          type="url"
          value={trackingURL}
          onChange={(e) => setTrackingURL(e.target.value)}
        />
      </TableCell>
      <TableCell>
        <Button onClick={() => OnSaveClick(row.node)}>
          Save
        </Button>
      </TableCell>
    </>
  )
}

export default function Page() {
  const [{ data, error }] = useGetOrdersQuery();
  const orders = data?.orders?.edges.filter((order) => !order.node.fulfillments || order.node.fulfillments.length <= 0)
  const isOpen = useErrorStore().isOpen
  const errorMessage = useErrorStore().errorMessage
  const closeError = useErrorStore().closeError

  return (
    <div>
      <div className="absolute top-0">
        <Snackbar
          anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
          open={isOpen}
          autoHideDuration={3900}
          onClose={() => closeError()}
        >
          <Alert
            onClose={() => closeError()}
            severity="error"
            variant="filled"
            sx={{ width: '100%' }}
          >
            {errorMessage}
          </Alert>
        </Snackbar>
      </div>
      <h1>Orders without shipment</h1>
      {
        orders && orders.length > 0 ?
          (<TableContainer component={Paper}>
            <Table aria-label="checkouts table">
              <TableHead>
                <TableRow>
                  <TableCell>No.</TableCell>
                  <TableCell>Order Id</TableCell>
                  <TableCell>Created At</TableCell>
                  <TableCell>Tracking number</TableCell>
                  <TableCell>Tracking URL</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {orders.map((row, i) => (
                  <TableRow key={row.node.id}>
                    <Order row={row} i={i} />
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>)
          : (
            <div>No data to display...</div>
          )
      }
    </div >
  )
}