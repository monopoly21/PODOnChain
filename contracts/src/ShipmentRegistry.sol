// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/interfaces/IERC1271.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

interface IOrderRegistry {
  function releaseEscrowFromShipment(uint256 orderId, address courier, uint256 courierReward) external;
}

contract ShipmentRegistry is EIP712 {
  using ECDSA for bytes32;

  struct Shipment {
    address buyer;
    address supplier;
    address courier;
    uint256 orderId;
    bool pickupCourierSigned;
    bool pickupSupplierSigned;
    bool dropCourierSigned;
    bool dropBuyerSigned;
    bool delivered;
    bytes32 pickupHash;
    bytes32 dropHash;
    uint64 pickupTs;
    uint64 dropTs;
  }

  struct PickupApproval {
    bytes32 shipmentId;
    uint256 orderId;
    bytes32 locationHash;
    uint64 claimedTs;
  }

  struct DropApproval {
    bytes32 shipmentId;
    uint256 orderId;
    bytes32 locationHash;
    uint64 claimedTs;
    uint256 distanceMeters;
  }

  address public immutable owner;
  address public immutable orderRegistry;
  uint256 public constant REWARD_PER_METER = 10; // 0.00001 units with 6 decimals

  bytes32 private constant PICKUP_TYPEHASH =
    keccak256(
      "PickupApproval(bytes32 shipmentId,uint256 orderId,bytes32 locationHash,uint64 claimedTs)"
    );
  bytes32 private constant DROP_TYPEHASH =
    keccak256(
      "DropApproval(bytes32 shipmentId,uint256 orderId,bytes32 locationHash,uint64 claimedTs,uint256 distanceMeters)"
    );

  mapping(bytes32 => Shipment) private shipments;

  event ShipmentRegistered(
    bytes32 indexed shipmentId,
    uint256 indexed orderId,
    address buyer,
    address supplier,
    address courier
  );
  event CourierUpdated(bytes32 indexed shipmentId, address courier);
  event ShipmentEvent(uint256 indexed orderId, uint8 indexed milestone, string geohash, bytes32 proofHash, uint256 blockTimestamp);
  event PickupApproved(
    bytes32 indexed shipmentId,
    uint256 indexed orderId,
    bytes32 locationHash,
    uint64 claimedTimestamp
  );
  event DropApproved(
    bytes32 indexed shipmentId,
    uint256 indexed orderId,
    bytes32 locationHash,
    uint64 claimedTimestamp,
    uint256 distanceMeters,
    uint256 courierReward
  );

  error UnknownShipment();
  error InvalidParticipant();
  error OrderMismatch();
  error AlreadyDelivered();
  error PickupAlreadyConfirmed();
  error PickupIncomplete();
  error SignatureMismatch();
  error DistanceOverflow();

  modifier onlyOwner() {
    require(msg.sender == owner, "not owner");
    _;
  }

  constructor(address _orderRegistry) EIP712("PODxShipment", "1") {
    require(_orderRegistry != address(0), "registry required");
    owner = msg.sender;
    orderRegistry = _orderRegistry;
  }

  function registerShipment(
    bytes32 shipmentId,
    uint256 orderId,
    address buyer,
    address supplier,
    address courier
  ) external onlyOwner {
    if (shipmentId == bytes32(0) || orderId == 0) revert UnknownShipment();
    if (buyer == address(0) || supplier == address(0) || courier == address(0)) {
      revert InvalidParticipant();
    }

    shipments[shipmentId] = Shipment({
      buyer: buyer,
      supplier: supplier,
      courier: courier,
      orderId: orderId,
      pickupCourierSigned: false,
      pickupSupplierSigned: false,
      dropCourierSigned: false,
      dropBuyerSigned: false,
      delivered: false,
      pickupHash: bytes32(0),
      dropHash: bytes32(0),
      pickupTs: 0,
      dropTs: 0
    });

    emit ShipmentRegistered(shipmentId, orderId, buyer, supplier, courier);
  }

  function updateCourier(bytes32 shipmentId, address courier) external onlyOwner {
    if (courier == address(0)) revert InvalidParticipant();
    Shipment storage shipment = _requireShipment(shipmentId);
    shipment.courier = courier;
    emit CourierUpdated(shipmentId, courier);
  }

  function getShipment(bytes32 shipmentId) external view returns (Shipment memory) {
    return shipments[shipmentId];
  }

  function confirmPickup(
    PickupApproval calldata approval,
    bytes calldata courierSignature,
    bytes calldata supplierSignature
  ) external {
    Shipment storage shipment = _requireShipment(approval.shipmentId);
    if (shipment.orderId != approval.orderId) revert OrderMismatch();
    if (shipment.delivered) revert AlreadyDelivered();
    if (shipment.pickupCourierSigned || shipment.pickupSupplierSigned) {
      revert PickupAlreadyConfirmed();
    }

    bytes32 pickupDigest = _pickupDigest(approval);
    if (!_isValidSignature(shipment.courier, pickupDigest, courierSignature)) revert SignatureMismatch();
    if (!_isValidSignature(shipment.supplier, pickupDigest, supplierSignature)) revert SignatureMismatch();

    shipment.pickupCourierSigned = true;
    shipment.pickupSupplierSigned = true;
    shipment.pickupHash = approval.locationHash;
    shipment.pickupTs = approval.claimedTs;

    emit PickupApproved(approval.shipmentId, approval.orderId, approval.locationHash, approval.claimedTs);
  }

  function confirmDrop(
    DropApproval calldata approval,
    bytes calldata courierSignature,
    bytes calldata buyerSignature
  ) external {
    Shipment storage shipment = _requireShipment(approval.shipmentId);
    if (shipment.orderId != approval.orderId) revert OrderMismatch();
    if (!shipment.pickupCourierSigned || !shipment.pickupSupplierSigned) revert PickupIncomplete();
    if (shipment.delivered) revert AlreadyDelivered();

    bytes32 dropDigest = _dropDigest(approval);
    if (!_isValidSignature(shipment.courier, dropDigest, courierSignature)) revert SignatureMismatch();
    if (!_isValidSignature(shipment.buyer, dropDigest, buyerSignature)) revert SignatureMismatch();

    shipment.dropCourierSigned = true;
    shipment.dropBuyerSigned = true;
    shipment.dropHash = approval.locationHash;
    shipment.dropTs = approval.claimedTs;
    shipment.delivered = true;

    uint256 reward = _calculateReward(approval.distanceMeters);

    emit DropApproved(
      approval.shipmentId,
      approval.orderId,
      approval.locationHash,
      approval.claimedTs,
      approval.distanceMeters,
      reward
    );

    IOrderRegistry(orderRegistry).releaseEscrowFromShipment(approval.orderId, shipment.courier, reward);
  }

  function markEvent(uint256 orderId, uint8 milestone, string calldata geohash, bytes32 proofHash) external {
    emit ShipmentEvent(orderId, milestone, geohash, proofHash, block.timestamp);
  }

  function _calculateReward(uint256 distanceMeters) private pure returns (uint256) {
    if (distanceMeters == 0) return 0;
    if (distanceMeters > type(uint256).max / REWARD_PER_METER) revert DistanceOverflow();
    return distanceMeters * REWARD_PER_METER;
  }

  function _requireShipment(bytes32 shipmentId) private view returns (Shipment storage) {
    Shipment storage shipment = shipments[shipmentId];
    if (shipment.orderId == 0) revert UnknownShipment();
    return shipment;
  }

  function _hashPickup(PickupApproval calldata approval) private pure returns (bytes32) {
    return keccak256(
      abi.encode(
        PICKUP_TYPEHASH,
        approval.shipmentId,
        approval.orderId,
        approval.locationHash,
        approval.claimedTs
      )
    );
  }

  function _hashDrop(DropApproval calldata approval) private pure returns (bytes32) {
    return keccak256(
      abi.encode(
        DROP_TYPEHASH,
        approval.shipmentId,
        approval.orderId,
        approval.locationHash,
        approval.claimedTs,
        approval.distanceMeters
      )
    );
  }

  function _pickupDigest(PickupApproval calldata approval) private view returns (bytes32) {
    return _hashTypedDataV4(_hashPickup(approval));
  }

  function _dropDigest(DropApproval calldata approval) private view returns (bytes32) {
    return _hashTypedDataV4(_hashDrop(approval));
  }

  function _isValidSignature(address signer, bytes32 digest, bytes calldata signature) private view returns (bool) {
    if (signer == address(0)) {
      return false;
    }
    if (signer.code.length > 0) {
      try IERC1271(signer).isValidSignature(digest, signature) returns (bytes4 magic) {
        return magic == IERC1271.isValidSignature.selector;
      } catch {
        return false;
      }
    }
    (address recovered, ECDSA.RecoverError err, ) = ECDSA.tryRecover(digest, signature);
    if (err != ECDSA.RecoverError.NoError) {
      return false;
    }
    return recovered == signer;
  }
}
