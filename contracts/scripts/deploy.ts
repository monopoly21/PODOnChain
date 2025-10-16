import { ethers } from "hardhat"

async function main() {
  const [deployer] = await ethers.getSigners()
  console.log("Deployer:", deployer.address)

  const tokenAddress = process.env.PYUSD_ADDRESS
  if (!tokenAddress) {
    throw new Error("PYUSD_ADDRESS env var is required")
  }

  const escrowFactory = await ethers.getContractFactory("EscrowPYUSD")
  const escrow = await escrowFactory.deploy(tokenAddress)
  await escrow.waitForDeployment()
  console.log("EscrowPYUSD:", await escrow.getAddress())

  const orderFactory = await ethers.getContractFactory("OrderRegistry")
  const order = await orderFactory.deploy(await escrow.getAddress())
  await order.waitForDeployment()
  console.log("OrderRegistry:", await order.getAddress())

  const shipmentFactory = await ethers.getContractFactory("ShipmentRegistry")
  const shipment = await shipmentFactory.deploy(await order.getAddress())
  await shipment.waitForDeployment()
  console.log("ShipmentRegistry:", await shipment.getAddress())

  await (await escrow.setOrderRegistry(await order.getAddress())).wait()
  await (await order.setShipmentRegistry(await shipment.getAddress())).wait()

  if (process.env.DELIVERY_ORACLE_PKP) {
    await (await order.setOracle(process.env.DELIVERY_ORACLE_PKP)).wait()
    console.log("Order oracle set to:", process.env.DELIVERY_ORACLE_PKP)
  }

  console.log("\nSet the following environment variables:")
  console.log("ESCROW_PYUSD_ADDRESS=", await escrow.getAddress())
  console.log("ORDER_REGISTRY_ADDRESS=", await order.getAddress())
  console.log("SHIPMENT_REGISTRY_ADDRESS=", await shipment.getAddress())
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
